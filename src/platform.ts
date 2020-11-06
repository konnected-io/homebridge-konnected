import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM, PLUGIN_NAME } from './settings';
import { ZONES_TO_PINS, ZONE_TYPES, ZONE_TYPES_TO_NAMES } from './constants';
import { PanelObjectInterface } from './interfaces';
import { ReplaceCircular } from './utilities';
import { KonnectedPlatformAccessory } from './platformAccessory';

import client from 'node-ssdp';      // for devices discovery
import express from 'express';       // for the listening API
import fetch from 'node-fetch';      // for making calls to the device
import http from 'http';             // for creating a listening server
import path from 'path';             // for getting filesystem meta
import fs from 'fs';                 // for working with the filesystem
import ip from 'ip';                 // for getting active IP on the system
import { v4 as uuidv4 } from 'uuid'; // for creating auth tokens

/**
 * HomebridgePlatform Class
 *
 * This class is the main constructor of the Konnected Homebridge plugin.
 *
 * The following operations are performed when the plugin is loaded:
 * - parse the user config
 * - restore existing accessories
 * - set up a listening server to listen for signals from the Konnected alarm panels and accessories
 * - discovery of Konnected alarm panels on the network
 * - add Konnected alarm panels to Homebridge config
 * - provision Konnected alarm panels with zone/pin assignments
 * - 
 */
export class KonnectedHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly Accessory: typeof PlatformAccessory = this.api.platformAccessory;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  // define shared variables here
  public platform: string = this.config.platform || PLATFORM; // konnected
  public platformName: string = this.config.name || PLATFORM_NAME; // Konnected
  public pluginName: string = this.config.pluginName || PLUGIN_NAME; // homebridge-konnected
  public listenerIP: string = this.config.advanced?.listenerIP || ip.address(); // system defined primary network interface
  public listenerPort: number = this.config.advanced?.listenerPort || 0; // zero = autochoose
  private listenerAuth: string[] = []; // for storing random auth strings
  // public configPath = process.env.UIX_CONFIG_PATH || path.resolve(os.homedir(), '.homebridge/config.json');

  constructor(public readonly log: Logger, public readonly config: PlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform');

    // Homebridge looks for and fires this event when it has restored all cached accessories from disk
    // this event is also used to init other methods for this plugin
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');

      // run the listening server & discover panels
      this.listeningServer();
      this.discoverPanels();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Creates a listening server for state changes from the alarm panel zones.
   * https://help.konnected.io/support/solutions/articles/32000026814-sensor-state-callbacks
   */
  listeningServer() {
    const app = express();
    const server = http.createServer(app);
    app.use(express.json());

    server.listen(this.listenerPort, () => {
      // store port to its global variable
      this.listenerPort = server.address()!['port'];
      this.log.info(`Listening for zone changes on ${this.listenerIP} port ${this.listenerPort}`);
    });

    // restart/crash cleanup
    const cleanup = () => {
      server.on('close', () => {
        process.exit(0);
      });
      server.close();
      this.log.info(`Listening port ${this.listenerPort} closed and released`);
    };
    process.on('SIGINT', cleanup).on('SIGTERM', cleanup);

    const respond = (req, res) => {
      // console.log(res);

      // validate bearer auth token
      if (this.listenerAuth.includes(req.headers.authorization.split('Bearer ').pop())) {
        // send the following response
        res.status(200).json({ success: true });

        this.log.info(`Authentication successful for ${req.params.id}`);
        this.log.info('Authentication token:', req.headers.authorization.split('Bearer ').pop());
        this.log.info(req.body);

        // NEXT:
        // call state change logic
        // check to see if that id exists
      } else {
        // send the following response
        res.status(401).json({
          success: false,
          reason: 'Authorization failed, token not valid',
        });

        this.log.error(`Authentication failed for ${req.params.id}, token not valid`);
        this.log.error('Authentication token:', req.headers.authorization.split('Bearer ').pop());
        this.log.error(req.body);
        // this.log.error(req.connection.remoteAddress); // this is consistent from the panel
        // this.log.error(req.connection.remotePort); // this is random from the panel

        // NEXT:
        // we need to reprovision the device with a new token
        // we need to get the timing of when the device finishes its retry attempts and reboots
        // after it reboots, there's a window of opportunity to re-provision the device

        // PROBLEMS WITH REPROVISIONING:
        // if we reprovision here, the reprovision task will run on each inbound request
        // we need to make sure the reprovision is only called once for each device
        // to allow the device to reboot with the new authentication creds, etc.
      }
    };

    // listen for requests at the following route/endpoint
    app
      .route('/api/konnected/device/:id')
      .put(respond) // Alarm Panel V1/V2
      .post(respond); // Alarm Panel Pro
  }

  /**
   * Discovers alarm panels on the network.
   * https://help.konnected.io/support/solutions/articles/32000026805-discovery
   *
   * Konnected SSDP Search Targets:
   * Alarm Panel V1/V2: urn:schemas-konnected-io:device:Security:1
   * Alarm Panel Pro: urn:schemas-konnected-io:device:Security:2
   */
  discoverPanels() {
    const ssdpClient = new client.Client();
    const ssdpTimeout = (this.config.advanced?.discoveryTimeout || 10) * 1000;
    const ssdpUrnPartial = 'urn:schemas-konnected-io:device';
    const ssdpDeviceIDs: string[] = []; // used later for deduping

    // begin discovery
    ssdpClient.search('ssdp:all');

    // on discovery
    ssdpClient.on('response', (headers) => {
      // check for only konnected devices
      if (headers.ST!.indexOf(ssdpUrnPartial) !== -1) {
        // store reported URL of panel that responded
        const ssdpHeaderLocation: string = headers.LOCATION || '';
        // extract UUID of panel from the USN string
        const panelUUID: string = headers.USN!.match(/^uuid:(.*)::.*$/i)![1] || '';

        // console.log(ssdpHeaderUSN);
        // console.log(ssdpHeaderLocation);
        // console.log('headers:', headers);

        // dedupe responses and then provision panel(s)
        if (!ssdpDeviceIDs.includes(panelUUID)) {
          // get panel status object (not using async await)
          fetch(ssdpHeaderLocation.replace('Device.xml', 'status'))
            // convert response to JSON
            .then((fetchResponse) => fetchResponse.json())
            .then((panelResponseObject) => {
              // create listener object to pass back to panel when provisioning it
              const listenerObject = {
                ip: this.listenerIP,
                port: this.listenerPort,
              };

              // use the above information to construct panel in homebridge config
              this.addPanelToConfig(panelUUID, panelResponseObject);

              // if the settings property does not exist in the response, then we have an unprovisioned panel
              if (Object.keys(panelResponseObject.settings).length === 0) {
                this.provisionPanel(panelUUID, panelResponseObject, listenerObject);
              } else {
                const panelBroadcastEndpoint = new URL(panelResponseObject.settings.endpoint);
                // if the IP address or port are not the same, reprovision endpoint component
                if (
                  panelBroadcastEndpoint.host !== this.listenerIP ||
                  Number(panelBroadcastEndpoint.port) !== this.listenerPort
                ) {
                  this.provisionPanel(panelUUID, panelResponseObject, listenerObject);
                }
              }
            });
          // if the panel does not respond, there's a severe error
          /*
          .catch((error) => {
            this.log.error(`Cannot get panel ${panelUUID} status. ${error}`);
            throw error;
          });
          */

          // add the UUID to the deduping array
          ssdpDeviceIDs.push(panelUUID);
        }
      }
    });

    // stop discovery after a number of seconds seconds, default is 10
    setTimeout(() => {
      ssdpClient.stop();
      console.log('devices:', ssdpDeviceIDs);
    }, ssdpTimeout);
  }

  /**
   * This method adds panels to the Homebridge config file to help users
   * with multiple konnected panel/board setups in their alarm system.
   *
   * @param panelUUID string  UUID for the panel as reported in the USN on discovery.
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   */
  addPanelToConfig(panelUUID: string, panelObject: PanelObjectInterface) {
    // console.log('passed in panelUUID: ', panelUUID);

    // validate panel UUID
    let validatedPanelUUID: string;
    const uuidRegexPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]+$/gi;
    if (panelUUID.match(uuidRegexPattern) !== null) {
      validatedPanelUUID = panelUUID;
    } else {
      this.log.error(`${panelUUID} is an invalid UUID structure for the panel at ${panelObject.ip}`);
      return;
    }

    // sanitize panel name
    let panelName = typeof panelObject.model !== 'undefined' ? panelObject.model : 'Konnected V1/V2';
    panelName = panelName.replace(/[^A-Za-z0-9\s/'":\-#.]/gi, ''); // sanitized

    // create panel block with validated/sanitized panel name and UUID
    const newPanel = {
      name: panelName,
      uuid: validatedPanelUUID,
    };

    // check backups/config-backups directory exists, if not use base storage directory
    const backupPath = fs.existsSync(this.api.user.storagePath() + '/backups/config-backups/')
      ? this.api.user.storagePath() + '/backups/config-backups/config.json.' + new Date().getTime()
      : this.api.user.storagePath() + '/config.json.' + new Date().getTime();

    // get homebridge config file
    const configPath = this.api.user.configPath();
    const configRawData = fs.readFileSync(configPath);
    const configJsonObject = JSON.parse(configRawData.toString());

    // copy config to new variable for alterations
    const newConfigJsonObject = configJsonObject;

    // if we can read the JSON from the config
    if (newConfigJsonObject) {
      // loop through platforms
      for (const platform of newConfigJsonObject.platforms) {
        // isolate konnected platform block
        if (platform.platform === 'konnected') {
          // if no panels defined in konnected platform config block
          // OR
          // we can't find the UUID property for the panel object in the panels array
          if (typeof platform.panels === 'undefined' || !platform.panels.some((panel) => panel.uuid === panelUUID)) {
            // if undefined, instantiate panels property as array
            if (typeof platform.panels === 'undefined') {
              platform.panels = [];
            }

            // push panel objects into panels array
            platform.panels.push(newPanel);

            // write backup config file
            fs.writeFileSync(path.resolve(backupPath), JSON.stringify(configJsonObject, null, 4));

            // write to config file
            fs.writeFileSync(path.resolve(configPath), JSON.stringify(newConfigJsonObject, null, 4));
          }
        }
      }
    }
  }

  /**
   * This is a constructor method to build the payload for assigning zone types on the panel.
   * https://help.konnected.io/support/solutions/articles/32000026807-device-provisioning
   * https://help.konnected.io/support/solutions/articles/32000026808-pin-mapping
   * https://help.konnected.io/support/solutions/articles/32000028978-alarm-panel-pro-inputs-and-outputs
   *
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   */
  configureZones(panelUUID: string, panelObject: PanelObjectInterface) {
    const sensors: unknown[] = [];
    const dht_sensors: unknown[] = [];
    const ds18b20_sensors: unknown[] = [];
    const actuators: unknown[] = [];

    // if there are panels in the plugin config
    if (typeof this.config.panels !== 'undefined') {
      // loop through the available panels
      for (const configPanel of this.config.panels) {
        // isolate specific panel and make sure there are zones in that panel
        if (configPanel.uuid === panelUUID && configPanel.zones) {
          // variable for checking multiple zones with the same zoneNumber assigned
          // (if users don't use Config UI X to generate their config)
          const zonesCheck: number[] = [];

          configPanel.zones.forEach((configPanelZone) => {
            // create type interface for panelZone variable
            interface PanelZone {
              pin?: number;
              zone?: number;
            }
            let panelZone: PanelZone;

            // check if zoneNumber is a duplicate
            if (!zonesCheck.includes(configPanelZone.zoneNumber)) {
              // if not a duplicate, push it into the zoneCheck array
              zonesCheck.push(configPanelZone.zoneNumber);

              // V1/V2 vs Pro detection
              if ('model' in panelObject) {
                // this is a Pro panel
                panelZone = {
                  zone: configPanelZone.zoneNumber,
                };
              } else {
                // this is a V1/V2 panel
                // convert zone to a pin
                if (ZONES_TO_PINS[configPanelZone.zoneNumber]) {
                  const zonePin = ZONES_TO_PINS[configPanelZone.zoneNumber];
                  panelZone = {
                    pin: zonePin,
                  };
                } else {
                  panelZone = {};
                  this.log.warn(
                    `Invalid Zone: Cannot assign the zone number '${configPanelZone.zoneNumber}' for Konnected V1/V2 Alarm Panels.`
                  );
                }
              }

              if (ZONE_TYPES.sensors.includes(configPanelZone.zoneType)) {
                sensors.push(panelZone);
              } else if (ZONE_TYPES.dht_sensors.includes(configPanelZone.zoneType)) {
                dht_sensors.push(panelZone);
              } else if (ZONE_TYPES.ds18b20_sensors.includes(configPanelZone.zoneType)) {
                ds18b20_sensors.push(panelZone);
              } else if (ZONE_TYPES.actuators.includes(configPanelZone.zoneType)) {
                actuators.push(panelZone);
              }

              // register the zone with homebridge/homekit
              this.registerZoneAsAccessory(panelUUID, panelObject, {
                zoneNumber: configPanelZone.zoneNumber,
                zoneType: configPanelZone.zoneType,
                zoneLocation: configPanelZone.zoneLocation,
              });
            } else {
              this.log.warn(
                `Duplicate Zone: Zone number '${configPanelZone.zoneNumber}' is assigned in two or more zones, please check your homebridge configuration for panel with UUID ${panelUUID}.`
              );
            }
          });
        }
      }
    }
    // if there are no zones defined then we use our default blank array variables above this block

    const panelZonesPayload = {
      sensors: sensors,
      dht_sensors: dht_sensors,
      ds18b20_sensors: ds18b20_sensors,
      actuators: actuators,
    };

    return panelZonesPayload;
  }

  /**
   * This method provisions alarm panel boards with information to communicate with this plugin
   * and to register the zones on the board according to their configured settings in this plugin.
   * https://help.konnected.io/support/solutions/articles/32000026807-device-provisioning
   *
   * @param panelUUID string  UUID for the panel as reported in the USN on discovery.
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   * @param listenerObject object  Details object for this plugin's listening server.
   */
  provisionPanel(panelUUID: string, panelObject: PanelObjectInterface, listenerObject) {
    const listeningEndpoint = `http://${listenerObject.ip}:${listenerObject.port}/api/konnected`;
    const panelSettingsEndpoint = `http://${panelObject.ip}:${panelObject.port}/settings`;

    const bearerAuthToken = uuidv4(); // generate an RFC4122 compliant UUID
    this.listenerAuth.push(bearerAuthToken); // add to array for listening authorization
    // console.log('this.listenerAuth:', this.listenerAuth);
    // console.log('token:', bearerAuthToken);

    const panelPayloadCore = {
      endpoint_type: 'rest',
      endpoint: listeningEndpoint,
      token: bearerAuthToken,
      blink: true,
      discovery: true,
    };

    const panelPayloadAccessories = this.configureZones(panelUUID, panelObject);

    const panelConfigurationPayload = {
      ...panelPayloadCore,
      ...panelPayloadAccessories,
    };

    if ('model' in panelObject) {
      this.log.info('Provisioning PRO panel...');
    } else {
      this.log.info('Provisioning V1/V2 panel...');
    }

    const provisionPanelResponse = async (url: string) => {
      try {
        await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(panelConfigurationPayload),
        });
      } catch (error) {
        if (error.errno === 'ECONNRESET') {
          this.log.info(
            `The panel at http://${panelObject.ip}:${panelObject.port}/ has disconnected and is likely rebooting to apply new provisioning settings`
          );
        } else {
          this.log.error(error);
        }
      }
    };
    provisionPanelResponse(panelSettingsEndpoint);
  }

  /**
   * This method registers panel zones as accessories in homebridge.
   *
   * @param panelUUID string  UUID for the panel as reported in the USN on discovery.
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   * @param panelZoneObject object  Zone object with zone number and zone type.
   */
  registerZoneAsAccessory(
    panelUUID: string,
    panelObject: PanelObjectInterface,
    panelZoneObject: {
      zoneNumber: string;
      zoneType: string;
      zoneLocation: string;
    }
  ) {

    const panelShortUUID: string = panelUUID.match(/([^-]+)$/i)![1];
    const panelModel = 'model' in panelObject ? 'Pro' : 'V1/V2';

    const device = {
      UUID: this.api.hap.uuid.generate(panelShortUUID + '-' + panelZoneObject.zoneNumber),
      displayName: panelZoneObject.zoneLocation + ' ' + ZONE_TYPES_TO_NAMES[panelZoneObject.zoneType],
      type: panelZoneObject.zoneType,
      model: panelModel + ' ' + ZONE_TYPES_TO_NAMES[panelZoneObject.zoneType],
      serialNumber: panelShortUUID + '-' + panelZoneObject.zoneNumber,
    };

    console.log(device);

    // this.log.info('this.accessories:', this.accessories);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === device.UUID);

    // check if the accessory already exists
    if (existingAccessory && existingAccessory.context.device.UUID === device.UUID) {
      this.log.info('Restoring existing accessory from cache:', `${existingAccessory.displayName} (${existingAccessory.UUID})`);

      existingAccessory.context.device = device;

      // create the accessory handler for the restored accessory
      // this is imported from `platformAccessory.ts`
      new KonnectedPlatformAccessory(this, existingAccessory);

      // update accessory in platform and homekit
      this.api.updatePlatformAccessories([existingAccessory]);

      // otherwise if it doesn't exist
    } else {
      this.log.info('Adding new accessory:', `${device.displayName} (${device.UUID})`);

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.displayName, device.UUID);

      // store a copy of the device object in the platform accessory
      accessory.context.device = device;

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new KonnectedPlatformAccessory(this, accessory);

      // link accessory to your platform and homekit
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM, [accessory]);
    }
  }

  /**
   * This method removes panel zones as accessories in homebridge & homekit.
   *
   * @param panelUUID string  UUID for the panel as reported in the USN on discovery.
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   * @param panelZoneObject object  Zone object with zone number and zone type.
   */
  unRegisterZoneAsAccessory(
    panelUUID: string,
    panelObject: PanelObjectInterface,
    panelZoneObject: {
      zoneNumber: string;
      zoneType: string;
      zoneLocation: string;
    }
  ) {
    console.log('panelUUID:', panelUUID);
    console.log('panelObject:', panelObject);
    console.log('panelZoneObject:', panelZoneObject);

    const panelShortUUID: string = panelUUID.match(/([^-]+)$/i)![1];
    const panelModel = 'model' in panelObject ? panelObject.model : 'Konnected V1/V2';

    const device = {
      // UUID: this.api.hap.uuid.generate(panelShortUUID + '-' + panelZoneObject.zoneNumber)
      UUID: panelShortUUID + '-' + panelZoneObject.zoneNumber,
      displayName: panelZoneObject.zoneLocation + ' ' + ZONE_TYPES_TO_NAMES[panelZoneObject.zoneType],
      model: panelModel + ' ' + ZONE_TYPES_TO_NAMES[panelZoneObject.zoneType],
    };

    console.log(device);

    // this.log.info('this.accessories:', this.accessories);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === device.UUID);

    this.log.info('existingAccessory?.context.device.UUID:', existingAccessory?.context.device.UUID);

    // check if the accessory already exists
    if (existingAccessory && existingAccessory.context.device.exampleUniqueId === device.UUID) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

      existingAccessory.context.device = device;

      // create the accessory handler for the restored accessory
      // this is imported from `platformAccessory.ts`
      // new KonnectedPlatformAccessory(this, existingAccessory);

      // update accessory in platform and homekit
      // this.api.updatePlatformAccessories([existingAccessory]);

      // otherwise if it doesn't exist
    } else if (existingAccessory && existingAccessory.context.device.exampleUniqueId !== device.UUID) {
      this.log.info('Removing accessory from cache:', existingAccessory.displayName);

      // remove accessory from platform and homekit
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM, [existingAccessory]);

      // otherwise if it doesn't exist
    } else {
      this.log.info('Adding new accessory:', device.UUID);

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.displayName, device.UUID);

      // store a copy of the device object in the platform accessory
      accessory.context.device = device;

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      // new KonnectedPlatformAccessory(this, accessory);

      // link accessory to your platform and homekit
      // this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM, [accessory]);
    }
  }

  /**
   * The Konnected alarm panels do not have any logic for an "alarm system"
   *
   * We need to provide alarm system logic that implements an alarm system with states:
   * - armed away: all sensors actively monitored for changes, countdown beeps from piezo, then trigger siren/flashing light
   * - armed home: only perimeter sensors actively monitored, countdown beeps from piezo, then trigger siren/flashing light
   * - armed night: only perimeter sensors actively monitored, immediately trigger siren/flashing light with no countdown beeps from piezo
   * - disarmed: when sensors change state, check an option for momentary piezo beeps for change, but siren is never triggered
   *
   * We will likely need to make a call to a NoonLight method here at some point
   */
  registerAlarmSystem() {
    // when the alarm system is registered, then register zone accessories
    // this.registerAccessories();
  }

  /**
   * Actuate siren/light/switch method
   * @param device
   */
  actuateAccessory(device) {
    // check if accessory actuatable

    console.log(device);
  }
}
