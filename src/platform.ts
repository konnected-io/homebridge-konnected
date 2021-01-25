import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { ZONES, ZONES_TO_PINS, ZONE_TYPES, ZONE_TYPES_TO_ACCESSORIES, ZONE_TYPES_TO_NAMES } from './constants';
import { PanelObjectInterface, ZoneStatesRuntimeCache } from './interfaces';
// import { ReplaceCircular } from './utilities';
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

  // this is used to track restored Homebridge/HomeKit representational versions of accessories from the cache
  public readonly accessories: PlatformAccessory[] = [];

  // this is used to store an accessible reference to inialized accessories (used in accessory cache disk writes - don't update this often)
  public readonly konnectedPlatformAccessories = {};

  // this is used to store a non-blocking runtime state of the accessories
  // this saves having to make network requests to the Konnected panels for states, which can cause delayed 'no-response' flag on the tiles in homekit
  // the Konnected panels mostly do the pushing of states of sensors to Homebridge and update their states in Homebridge (and consequently
  // homekit) at that time, but when homekit does it's own interval of polling, the states don't change inbetween those polls
  public zoneStatesRuntimeCache: Record<string, unknown>[] = [];

  // define shared variables here
  private listenerIP: string =
    'advanced' in this.config
      ? 'listenerIP' in this.config.advanced
        ? this.config.advanced.listenerIP
        : ip.address()
      : ip.address(); // system defined primary network interface

  private listenerPort: number =
    'advanced' in this.config ? ('listenerPort' in this.config.advanced ? this.config.advanced.listenerPort : 0) : 0; // zero = autochoose

  private ssdpTimeout: number =
    'advanced' in this.config
      ? 'discoveryTimeout' in this.config.advanced
        ? this.config.advanced.discoveryTimeout * 1000
        : 5000
      : 5000; // 5 seconds

  private listenerAuth: string[] = []; // for storing random auth strings
  private ssdpDiscovering = false; // for storing state of SSDP discovery process

  constructor(public readonly log: Logger, public readonly config: PlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform');

    // Homebridge looks for and fires this event when it has retrieved all cached accessories from disk
    // this event is also used to init other methods for this plugin
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback. Accessories retreived from cache...');

      // run the listening server & discover panels
      this.listeningServer();
      this.discoverPanels();
    });
  }

  /**
   * This function is invoked when Homebridge restores cached accessories from disk at startup.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info(`Loading accessory from cache: ${accessory.displayName} (${accessory.UUID})`);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Creates a listening server for status and state changes from panels and zones.
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

      // bearer auth token not provided
      if (typeof req.headers.authorization === 'undefined') {
        this.log.error(`Authentication failed for ${req.params.id}, token missing, with request body:`, req.body);

        // send the following response
        res.status(401).json({
          success: false,
          reason: 'Authorization failed, token missing',
        });
        return;
      }

      // validate provided bearer auth token
      if (this.listenerAuth.includes(req.headers.authorization.split('Bearer ').pop())) {
        // send the following response
        res.status(200).json({ success: true });

        // process the update of the state
        this.updateAccessoryState(req);
      } else {
        // rediscover and reprovision panels
        if (this.ssdpDiscovering === false) {
          this.discoverPanels();
        }

        // send the following response
        res.status(401).json({
          success: false,
          reason: 'Authorization failed, token not valid',
        });

        this.log.error(`Authentication failed for ${req.params.id}, token not valid`);
        this.log.error('Authentication token:', req.headers.authorization.split('Bearer ').pop());
        this.log.error(req.body);
      }
    };

    // listen for requests at the following route/endpoint
    app
      .route('/api/konnected/device/:id')
      .put(respond) // Alarm Panel V1-V2
      .post(respond); // Alarm Panel Pro
  }

  /**
   * Discovers alarm panels on the network.
   * https://help.konnected.io/support/solutions/articles/32000026805-discovery
   *
   * Konnected SSDP Search Targets:
   * Alarm Panel V1-V2: urn:schemas-konnected-io:device:Security:1
   * Alarm Panel Pro: urn:schemas-konnected-io:device:Security:2
   */
  discoverPanels() {
    const ssdpClient = new client.Client();
    const ssdpUrnPartial = 'urn:schemas-konnected-io:device';
    const ssdpDeviceIDs: string[] = []; // used later for deduping

    // set discovery state
    this.ssdpDiscovering = true;

    // begin discovery
    ssdpClient.search('ssdp:all');

    // on discovery
    ssdpClient.on('response', (headers) => {
      // check for only Konnected devices
      if (headers.ST!.indexOf(ssdpUrnPartial) !== -1) {
        // store reported URL of panel that responded
        const ssdpHeaderLocation: string = headers.LOCATION || '';
        // extract UUID of panel from the USN string
        const panelUUID: string = headers.USN!.match(/^uuid:(.*)::.*$/i)![1] || '';

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

              // use the above information to construct panel in Homebridge config
              this.addPanelToConfig(panelUUID, panelResponseObject);

              // if the settings property does not exist in the response,
              // then we have an unprovisioned panel
              if (Object.keys(panelResponseObject.settings).length === 0) {
                this.provisionPanel(panelUUID, panelResponseObject, listenerObject);
              } else {
                if (panelResponseObject.settings.endpoint_type === 'rest') {
                  const panelBroadcastEndpoint = new URL(panelResponseObject.settings.endpoint);

                  // if the IP address or port are not the same, reprovision endpoint component
                  if (
                    panelBroadcastEndpoint.host !== this.listenerIP ||
                    Number(panelBroadcastEndpoint.port) !== this.listenerPort
                  ) {
                    this.provisionPanel(panelUUID, panelResponseObject, listenerObject);
                  }
                } else if (panelResponseObject.settings.endpoint_type === 'aws_iot') {
                  this.log.error(
                    `ERROR: Panel ${panelUUID} has previously been provisioned to use the Konnected Cloud and cannot be provisioned by Homebridge until you de-register your panel from the Konnected Cloud and factory reset it. Please use the Konnected mobile app to de-regester the panel from the Konnected Cloud.`
                  );
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

    // stop discovery after a number of seconds seconds, default is 5
    setTimeout(() => {
      ssdpClient.stop();
      this.ssdpDiscovering = false;
      console.log('devices:', ssdpDeviceIDs);
    }, this.ssdpTimeout);
  }

  /**
   * This method adds panels to the Homebridge config file to help users
   * with multiple Konnected panel setups in their alarm system.
   *
   * @param panelUUID string  UUID for the panel as reported in the USN on discovery.
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   */
  addPanelToConfig(panelUUID: string, panelObject: PanelObjectInterface) {
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
    let panelName = typeof panelObject.model !== 'undefined' ? panelObject.model : 'Konnected V1-V2';
    panelName = panelName.replace(/[^A-Za-z0-9\s/'":\-#.]/gi, ''); // sanitized

    // create panel block with validated/sanitized panel name and UUID
    const newPanel = {
      name: panelName,
      uuid: validatedPanelUUID,
      ipAddress: panelObject.ip,
      port: panelObject.port,
    };

    // check backups/config-backups directory exists, if not use base storage directory
    const backupPath = fs.existsSync(this.api.user.storagePath() + '/backups/config-backups/')
      ? this.api.user.storagePath() + '/backups/config-backups/config.json.' + new Date().getTime()
      : this.api.user.storagePath() + '/config.json.' + new Date().getTime();

    // get Homebridge config file
    const configPath = this.api.user.configPath();
    const configRawData = fs.readFileSync(configPath);
    const configJsonObject = JSON.parse(configRawData.toString());

    // copy config to new variable for alterations
    const newConfigJsonObject = configJsonObject;

    // if we can read the JSON from the config
    if (newConfigJsonObject) {
      // loop through platforms
      for (const platform of newConfigJsonObject.platforms) {
        // isolate Konnected platform block
        if (platform.platform === 'konnected') {
          // if no panels defined in Konnected platform config block or
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
   * This method provisions Konnected panels with information to communicate with this plugin
   * and to register the zones on the panel according to their configured settings in this plugin.
   * https://help.konnected.io/support/solutions/articles/32000026807-device-provisioning
   *
   * @param panelUUID string  UUID for the panel as reported in the USN on discovery.
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   * @param listenerObject object  Details object for this plugin's listening server.
   */
  provisionPanel(panelUUID: string, panelObject: PanelObjectInterface, listenerObject) {
    let panelIP: string = panelObject.ip;
    let panelPort: number = panelObject.port;
    let panelBlink = true;

    // if there are panels in the plugin config
    if (typeof this.config.panels !== 'undefined') {
      // loop through the available panels
      for (const configPanel of this.config.panels) {
        // isolate specific panel and make sure there are zones in that panel
        if (configPanel.uuid === panelUUID) {
          panelIP = configPanel.ipAddress ? configPanel.ipAddress : panelObject.ip;
          panelPort = configPanel.port ? configPanel.port : panelObject.port;
          panelBlink = typeof configPanel.blink !== 'undefined' ? configPanel.blink : true;
        }
      }
    }

    const listeningEndpoint = `http://${listenerObject.ip}:${listenerObject.port}/api/konnected`;
    const panelSettingsEndpoint = `http://${panelIP}:${panelPort}/settings`;

    const bearerAuthToken = uuidv4(); // generate an RFC4122 compliant UUID
    this.listenerAuth.push(bearerAuthToken); // add to array for listening authorization

    const panelPayloadCore = {
      endpoint_type: 'rest',
      endpoint: listeningEndpoint,
      token: bearerAuthToken,
      blink: panelBlink,
      discovery: true,
    };

    const panelPayloadAccessories = this.configureZones(panelUUID, panelObject);

    const panelConfigurationPayload = {
      ...panelPayloadCore,
      ...panelPayloadAccessories,
    };

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
            `The panel at ${url} has disconnected and is likely rebooting to apply new provisioning settings`
          );
        } else {
          this.log.error(error);
        }
      }
    };
    provisionPanelResponse(panelSettingsEndpoint);
  }

  /**
   * This is a constructor method to build the payload for assigning zone types on the panel.
   *
   * @param panelUUID string  The unique identifier for the panel itself.
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   */
  configureZones(panelUUID: string, panelObject: PanelObjectInterface) {
    const sensors: unknown[] = [];
    const dht_sensors: unknown[] = [];
    const ds18b20_sensors: unknown[] = [];
    const actuators: unknown[] = [];

    const retainedAccessories: unknown[] = [];

    // if there are panels in the plugin config
    if (typeof this.config.panels !== 'undefined') {
      // storage variable for the array of zones
      const zoneObjectsArray: Record<string, unknown>[] = [];

      // loop through the available panels
      for (const configPanel of this.config.panels) {
        // If there's a chipId in the panelObject, use that, or use mac address.
        // V1/V2 panels only have one interface (WiFi). Panels with chipId are Pro versions
        // with two network interfaces (WiFi & Ethernet) with separate mac addresses.
        // If one network interface goes down, the panel can fallback to the other
        // interface and the accessories lose their associated UUID, which can
        // result in duplicated accessories, half of which become non-responsive.
        const panelShortUUID: string = 'chipId' in panelObject ? panelUUID.match(/([^-]+)$/i)![1] : panelObject.mac.replace(/:/g, '');

        // isolate specific panel and make sure there are zones in that panel
        if (configPanel.uuid === panelUUID && configPanel.zones) {
          // variable for deduping zones with the same zoneNumber
          // (use-case: if users don't use Config UI X to generate their config)
          const zonesCheck: string[] = [];

          configPanel.zones.forEach((configPanelZone) => {
            // create type interface for panelZone variable
            interface PanelZone {
              pin?: number;
              zone?: number;
            }
            let panelZone: PanelZone = {};

            // Pro vs V1-V2 detection
            if ('model' in panelObject) {
              // this is a Pro panel
              // check if zone is improperly assigned as the V1-V2 panel 'out' zone
              if (configPanelZone.zoneNumber === 'out') {
                this.log.warn(
                  'Invalid Zone: Konnected Pro Alarm Panels do not have a zone named \'out\', change the zone assignment to \'alarm1\', \'out1\', or \'alarm2_out2\'.'
                );
              } else if (ZONE_TYPES.actuators.includes(configPanelZone.zoneType)) {
                // this zone is assigned as an actuator
                // validate if zone can be an actuator/switch
                if (ZONES[configPanelZone.zoneNumber].includes(configPanelZone.zoneType)) {
                  panelZone = {
                    zone: configPanelZone.zoneNumber,
                  };
                } else {
                  this.log.warn(
                    `Invalid Zone: Konnected Pro Alarm Panels cannot have zone ${configPanelZone.zoneNumber} as an actuator/switch. Try zones 1-8, alarm1, out1, or alarm2_out2.`
                  );
                }
              } else {
                panelZone = {
                  zone: configPanelZone.zoneNumber,
                };
              }
            } else {
              // this is a V1-V2 panel
              // convert zone to a pin
              if (ZONES_TO_PINS[configPanelZone.zoneNumber]) {
                panelZone = {
                  pin: ZONES_TO_PINS[configPanelZone.zoneNumber],
                };
              } else {
                this.log.warn(
                  `Invalid Zone: Cannot assign the zone number '${configPanelZone.zoneNumber}' for Konnected V1-V2 Alarm Panels. Try zones `
                );
              }
            }

            // check if the panel object is not empty (this will cause a boot loop if it's empty)
            if (Object.keys(panelZone).length > 0) {
              // put panelZone into the correct device type for the panel
              if (ZONE_TYPES.sensors.includes(configPanelZone.zoneType)) {
                sensors.push(panelZone);
              } else if (ZONE_TYPES.dht_sensors.includes(configPanelZone.zoneType)) {
                dht_sensors.push(panelZone);
              } else if (ZONE_TYPES.ds18b20_sensors.includes(configPanelZone.zoneType)) {
                ds18b20_sensors.push(panelZone);
              } else if (ZONE_TYPES.actuators.includes(configPanelZone.zoneType)) {
                actuators.push(panelZone);
              }
            }

            // genereate unique ID for zone
            const zoneUUID: string = this.api.hap.uuid.generate(panelShortUUID + '-' + configPanelZone.zoneNumber);

            // if there's a model in the panelObject, that means the panel is Pro
            const panelModel: string = 'model' in panelObject ? 'Pro' : 'V1-V2';

            // dedupe zones with the same zoneNumber
            if (!zonesCheck.includes(zoneUUID)) {
              // if not a duplicate, push the zone's UUID into the zoneCheck array
              zonesCheck.push(zoneUUID);

              const displayName = configPanelZone.zoneLocation ? configPanelZone.zoneLocation + ' ' : '';

              const zoneObject = {
                UUID: zoneUUID,
                displayName: displayName + ZONE_TYPES_TO_NAMES[configPanelZone.zoneType],
                type: configPanelZone.zoneType,
                model: panelModel + ' ' + ZONE_TYPES_TO_NAMES[configPanelZone.zoneType],
                serialNumber: panelShortUUID + '-' + configPanelZone.zoneNumber,
                panel: panelObject,
              };

              zoneObjectsArray.push(zoneObject);
              this.zoneStatesRuntimeCache.push(zoneObject);

              // match this zone's UUID to the UUID of an accessory stored in the global accessories cache
              // store accessory object in an array of retained accessories that we don't want unregistered in Homebridge and HomeKit
              if (typeof this.accessories.find((accessory) => accessory.UUID === zoneUUID) !== undefined) {
                retainedAccessories.push(this.accessories.find((accessory) => accessory.UUID === zoneUUID));
              }
            } else {
              this.log.warn(
                `Duplicate Zone: Zone number '${configPanelZone.zoneNumber}' is assigned in two or more zones, please check your Homebridge configuration for panel with UUID ${panelUUID}.`
              );
            }
          }); // end foreach loop (zones)

          // Now attempt to register the zones as accessories in Homebridge and HomeKit
          this.accessoryRegistrationController(panelShortUUID, zoneObjectsArray, retainedAccessories);
        } else if (configPanel.uuid === panelUUID && typeof configPanel.zones === 'undefined') {
          this.accessoryRegistrationController(panelShortUUID, [], []);
        }
      } // end for-of loop (panels)
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
   * Accessory controller to add, update, and remove panel zones as accessories in Homebridge (and HomeKit).
   *
   * @param panelShortUUID string  The panel short UUID for the panel of zones being passed in.
   * @param zoneObjectsArray array  An array of constructed zoneObjects.
   * @param retainedAccessoriesArray array  An array of retained accessory objects.
   */
  accessoryRegistrationController(panelShortUUID, zoneObjectsArray, retainedAccessoriesArray) {
    // console.log('zoneObjectsArray', zoneObjectsArray);
    // console.log('retainedAccessoriesArray:', retainedAccessoriesArray);

    // remove any stale accessories
    ///////////////////////////////

    const accessoriesToRemoveArray = this.accessories
      .filter(
        // filter in accessories with same panel
        (accessory) => accessory.context.device.serialNumber.split('-')[0] === panelShortUUID
      )
      .filter(
        // filter out retained accessories
        (accessory) => !retainedAccessoriesArray.includes(accessory)
      );

    if (Array.isArray(retainedAccessoriesArray) && retainedAccessoriesArray!.length > 0) {
      retainedAccessoriesArray.forEach((accessory) => {
        if (typeof accessory !== 'undefined') {
          this.log.debug(`Retained accessory: ${accessory.displayName}`);
        }
      });
    }

    if (Array.isArray(accessoriesToRemoveArray) && accessoriesToRemoveArray!.length > 0) {
      // unregister stale or missing zones/accessories in Homebridge and HomeKit
      accessoriesToRemoveArray.forEach((accessory) => {
        this.log.info(
          `Removing stale accessory: ${accessory.displayName} (${accessory.context.device.model})`
        );
      });
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemoveArray);
    }

    // update or create accessories
    ///////////////////////////////

    const accessoriesToUpdateArray: PlatformAccessory[] = [];
    const accessoriesToAddArray: PlatformAccessory[] = [];

    zoneObjectsArray.forEach((panelZoneObject) => {
      // find Homebridge cached accessories with the same uuid as those in the config
      const existingAccessory = this.accessories.find((accessory) => panelZoneObject.UUID === accessory.UUID);

      if (existingAccessory && existingAccessory.context.device.UUID === panelZoneObject.UUID) {
        // then the accessory already exists
        this.log.info(
          `Updating existing accessory: ${panelZoneObject.displayName} (${panelZoneObject.model})`
        );

        // update zone object in the platform accessory cache
        existingAccessory.displayName = panelZoneObject.displayName;
        existingAccessory.context.device = panelZoneObject;
        // store a direct reference to the initialized accessory with service and characteristics in the KonnectedPlatformAccessories object
        this.konnectedPlatformAccessories[panelZoneObject.UUID] = new KonnectedPlatformAccessory(
          this,
          existingAccessory
        );

        accessoriesToUpdateArray.push(existingAccessory);
      } else {
        // otherwise we're adding a new accessory
        this.log.info(
          `Adding new accessory: ${panelZoneObject.displayName} (${panelZoneObject.model})`
        );

        // build Homebridge/HomeKit platform accessory
        const newAccessory = new this.api.platformAccessory(panelZoneObject.displayName, panelZoneObject.UUID);
        // store zone object in the platform accessory cache
        newAccessory.context.device = panelZoneObject;
        // store a direct reference to the initialized accessory with service and characteristics in the KonnectedPlatformAccessories object
        this.konnectedPlatformAccessories[panelZoneObject.UUID] = new KonnectedPlatformAccessory(this, newAccessory);

        accessoriesToAddArray.push(newAccessory);
      }
    });

    if (Array.isArray(accessoriesToUpdateArray) || accessoriesToUpdateArray!.length) {
      // update zones/accessories in Homebridge and HomeKit
      this.api.updatePlatformAccessories(accessoriesToUpdateArray);
    }

    if (Array.isArray(accessoriesToAddArray) || accessoriesToAddArray!.length) {
      // add zones/accessories to Homebridge and HomeKit
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToAddArray);
    }
  }

  /**
   * The Konnected panels do not have any logic for an "alarm system"
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
    // for future
  }

  /**
   * Updates the cached zone state when a panel reports a change in the zone's state.
   *
   * @param req object  The request payload received for the zone at this plugin's listener REST endpoint.
   */
  updateAccessoryState(req) {
    let deviceZone = '';
    let deviceState = '';
    if ('pin' in req.body) {
      // convert a pin to a zone
      Object.entries(ZONES_TO_PINS).map(([key, value]) => {
        if (value === req.body.pin) {
          deviceZone = key;
          deviceState = JSON.stringify(req.body) + ` (zone: ${deviceZone})`;
        }
      });
    } else {
      // use the zone
      deviceZone = req.body.zone;
      deviceState = JSON.stringify(req.body);
    }

    const zoneUUID = this.api.hap.uuid.generate(req.params.id + '-' + deviceZone);

    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === zoneUUID);

    // check if the accessory already exists
    if (existingAccessory) {
      this.log.debug(`${existingAccessory.displayName}:`, deviceState);

      // loop through the accessories state cache and update state and service characteristic
      this.zoneStatesRuntimeCache.forEach((accessory) => {
        if (accessory.UUID === zoneUUID) {
          switch (ZONE_TYPES_TO_ACCESSORIES[existingAccessory.context.device.type]) {
            case 'ContactSensor':
              accessory.state = req.body.state;
              this.konnectedPlatformAccessories[existingAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.ContactSensorState,
                req.body.state
              );
              break;
            case 'MotionSensor':
              accessory.state = req.body.state;
              this.konnectedPlatformAccessories[existingAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.MotionDetected,
                req.body.state
              );
              break;
            case 'LeakSensor':
              accessory.state = req.body.state;
              this.konnectedPlatformAccessories[existingAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.LeakDetected,
                req.body.state
              );
              break;
            case 'SmokeSensor':
              accessory.state = req.body.state;
              this.konnectedPlatformAccessories[existingAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.SmokeDetected,
                req.body.state
              );
              break;
            case 'TemperatureSensor':
              accessory.temp = req.body.temp;
              this.konnectedPlatformAccessories[existingAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.CurrentTemperature,
                req.body.temp
              );
              break;
            case 'HumiditySensor':
              accessory.humidity = Math.round(req.body.humi);
              this.konnectedPlatformAccessories[existingAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.CurrentRelativeHumidity,
                accessory.humidity
              );
              this.konnectedPlatformAccessories[existingAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.CurrentTemperature,
                req.body.temp
              );
              break;

            case 'Switch':
              accessory.state = req.body.state;
              this.konnectedPlatformAccessories[existingAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.On,
                req.body.state
              );
              break;

            default:
              break;
          }
        }
      });
    }
  }

  /**
   * Method to actuate a switch type zone's state with the zone's specific switch advanced settings.
   *
   * @param device
   */
  actuateAccessory(zoneUUID, value) {
    
    // loop through accessories and get the panel endpoint address and the model of the panel for the zone
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === zoneUUID);

    if (existingAccessory) {
      // loop through the plugin configuration to get the correct panel for the zone
      this.config.panels.forEach((panelObject) => {
        if (panelObject.ipAddress === existingAccessory.context.device.panel.ip) {
          // build endpoint
          let panelEndpoint =
            'http://' +
            existingAccessory.context.device.panel.ip +
            ':' +
            existingAccessory.context.device.panel.port +
            '/';

          // loop through the plugin configuration to get the zone's switch advanced settings
          panelObject.zones.forEach((zoneObject) => {
            if (zoneObject.zoneNumber === existingAccessory.context.device.serialNumber.split('-')[1]) {
              const actuatorPayload: Record<string, unknown> = {
                // explicitly convert boolean to integer
                state: value === true ? 1 : 0,
              };

              let actuatorDuration;

              // Pro vs V1-V2 detection
              if ('model' in existingAccessory.context.device.panel) {
                // this is a Pro panel
                actuatorPayload.zone = zoneObject.zoneNumber;
                panelEndpoint += 'zone';
              } else {
                // this is a V1-V2 panel
                panelEndpoint += 'device';
                // convert zone to a pin
                if (ZONES_TO_PINS[Number(zoneObject.zoneNumber)]) {
                  actuatorPayload!.pin = ZONES_TO_PINS[Number(zoneObject.zoneNumber)];
                } else {
                  this.log.warn(
                    `Invalid Zone: Cannot actuate the zone number '${zoneObject.zoneNumber}' for Konnected V1-V2 Alarm Panels.`
                  );
                }
              }

              if (zoneObject.switchSettings) {
                // only do the following if the switch is turning on, otherwise we simply need send a payload of off
                if (value === true) {
                  if (zoneObject.switchSettings.pulseDuration) {
                    actuatorPayload.momentary = actuatorDuration = zoneObject.switchSettings.pulseDuration;
                  }
                  if (zoneObject.switchSettings.pulseRepeat && zoneObject.switchSettings.pulsePause) {
                    actuatorPayload.times = zoneObject.switchSettings.pulseRepeat;
                    actuatorPayload.pause = zoneObject.switchSettings.pulsePause;
                    if (zoneObject.switchSettings.pulseRepeat > 0) {
                      actuatorDuration =
                        actuatorDuration * zoneObject.switchSettings.pulseRepeat +
                        zoneObject.switchSettings.pulsePause * (zoneObject.switchSettings.pulseRepeat - 1);
                    }
                  }
                }
              }

              const actuatePanelZone = async (url: string) => {
                try {
                  const response = await fetch(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(actuatorPayload),
                  });
                  if (response.status === 200) {
                    if (
                      actuatorDuration &&
                      zoneObject.switchSettings.pulsePause &&
                      zoneObject.switchSettings.pulseRepeat !== -1
                    ) {
                      // this is a momentary switch, reset the state after done
                      setTimeout(() => {
                        // if state is on, turn off
                        const restoreState = value === true ? 0 : 1;
                        // update Homebridge/HomeKit displayed state
                        this.konnectedPlatformAccessories[zoneUUID].service.updateCharacteristic(
                          this.Characteristic.On,
                          restoreState
                        );
                        // update the state cache for subsequent HomeKit get calls
                        this.zoneStatesRuntimeCache.forEach((accessory) => {
                          if (accessory.UUID === zoneUUID) {
                            accessory.switch = restoreState;
                          }
                        });
                      }, actuatorDuration);
                    }
                  }
                } catch (error) {
                  this.log.error(error);
                }
              };
              actuatePanelZone(panelEndpoint);
            }
          });
        }
      });      
    }
  }
}