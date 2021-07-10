import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { ZONES, ZONES_TO_PINS, ZONE_TYPES, TYPES_TO_ACCESSORIES } from './constants';
import { PanelObjectInterface, RuntimeCacheInterface } from './interfaces';
// import { ReplaceCircular } from './utilities';
import { KonnectedPlatformAccessory } from './platformAccessory';

import client from 'node-ssdp';      // for devices discovery
import express from 'express';       // for the listening API
import fetch from 'node-fetch';      // for making calls to the device
import http from 'http';             // for creating a listening server
import path from 'path';             // for getting filesystem meta
import fs from 'fs';                 // for working with the filesystem
import ip from 'ip';                 // for getting active IP on the system
import { validate as uuidValidate, v4 as uuidv4 } from 'uuid'; // for handling UUIDs and creating auth tokens
import { URL } from 'url';

/**
 * HomebridgePlatform Class
 *
 * This class is the main constructor of the Konnected Homebridge plugin.
 *
 * The following operations are performed when the plugin is loaded:
 * - parse the user config
 * - retrieve existing accessories from cachedAccessories
 * - set up a listening server to listen for requests from the Konnected alarm panels
 * - set up 
 * - discovery of Konnected alarm panels on the network
 * - add Konnected alarm panels to Homebridge config
 * - provision Konnected alarm panels with zones configured if assigned
 * - CRUD accessories with characteristics in Homebridge/HomeKit if zones configured/assigned
 * - listen for zone changes and update states in runtime cache and Homebridge/Homekit
 * = react to state change requests from Homebridge/HomeKit and send actuator payload to panel
 */
export class KonnectedHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly Accessory: typeof PlatformAccessory = this.api.platformAccessory;

  // global array of references to restored Homebridge/HomeKit accessories from the cache
  // (used in accessory cache disk reads - this is also updated when accessories are initialized)
  public readonly accessories: PlatformAccessory[] = [];

  // global object of references to initialized Homebridge/Homekit accessories
  // (used in accessory cache disk writes - don't update this often)
  public readonly konnectedPlatformAccessories = {};

  // Sensor and actuator accessories can change often, we store a non-blocking state of them in a runtime cache.
  // This avoids experiencing two performance problems:
  // 1. a 'No Response' flag on accessory tiles in HomeKit when waiting for responses from the Konnected panels for states;
  // 2. constantly/expensively reading and writing to Homebridge's accessories cache.
  // NOTE: we do not store the security system accessory here, its state is maintained in the Homebridge accessories explicitly.
  public accessoriesRuntimeCache: RuntimeCacheInterface[] = [];

  // security system UUID (we only allow one security system per homebridge instance)
  private securitySystemUUID: string = this.api.hap.uuid.generate(this.config.platform);

  private entryTriggerDelay: number = this.config.advanced?.entryDelaySettings?.delay
    ? this.config.advanced?.entryDelaySettings?.delay * 1000
    : 30000; // zero = instant trigger

  private entryTriggerDelayTimerHandle;

  // define listening server variables
  private listenerIP: string = this.config.advanced?.listenerIP ? this.config.advanced.listenerIP : ip.address(); // system defined primary network interface
  private listenerPort: number = this.config.advanced?.listenerPort ? this.config.advanced.listenerPort : 0; // zero = autochoose
  private ssdpTimeout: number = this.config.advanced?.discoveryTimeout
    ? this.config.advanced.discoveryTimeout * 1000
    : 5000; // 5 seconds

  private listenerAuth: string[] = []; // for storing random auth strings
  private ssdpDiscovering = false; // for storing state of SSDP discovery process
  private ssdpDiscoverAttempts = 0;

  constructor(public readonly log: Logger, public readonly config: PlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform');

    // Homebridge looks for and fires this event when it has retrieved all cached accessories from disk
    // this event is also used to init other methods for this plugin
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback. Accessories retreived from cache...');

      // run the listening server & register the security system
      this.listeningServer();
      this.registerSecuritySystem();
      this.discoverPanels();
    });
  }

  /**
   * Homebridge's startup restoration of cached accessories from disk.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info(`Loading accessory from cache: ${accessory.displayName} (${accessory.context.device.serialNumber})`);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Create a listening server for status and state changes from panels and zones.
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
        if (['POST', 'PUT'].includes(req.method)) {
          // panel request to update zone
          res.status(200).json({ success: true });
          // process the update of the state
          this.updateSensorAccessoryState(req);
        } else if ('GET' === req.method) {
          // panel request to get the state of a Homebridge/HomeKit switch
          // then reply back to the panel to set the "source of truth" actuator state

          // create type interface for responsePayload variable
          interface ResponsePayload {
            success: true;
            pin?: string;
            zone?: string;
            state?: number;
          }

          // setup response payload to reply with
          const responsePayload: ResponsePayload = {
            success: true,
          };

          // default to zone for Pro panel, but may be replaced if V1-V1 panel
          let requestPanelZone = req.query.zone;

          if (req.query.pin) {
            // V1-V2 panel
            // change requestPanelZone variable to the zone equivalent of a pin on V1-V2 panels
            Object.entries(ZONES_TO_PINS).find(([zone, pin]) => {
              if (pin === Number(req.query.pin)) {
                requestPanelZone = zone;
              }
            });
            responsePayload.pin = req.query.pin;
          } else if (req.query.zone) {
            // Pro panel
            responsePayload.zone = requestPanelZone;
          }

          this.accessoriesRuntimeCache.find((runtimeCacheAccessory) => {
            if (runtimeCacheAccessory.serialNumber === req.params.id + '-' + requestPanelZone) {
              responsePayload.state =
                typeof runtimeCacheAccessory.state !== 'undefined' ? Number(runtimeCacheAccessory.state) : 0;
            }
          });
          this.log.debug(
            `Panel (${req.params.id}) requested zone '${requestPanelZone}' initial state, sending value of ${responsePayload.state}`
          );

          res.status(200).json(responsePayload);
        }
      } else {
        // send the following response
        res.status(401).json({
          success: false,
          reason: 'Authorization failed, token not valid',
        });

        this.log.error(`Authentication failed for ${req.params.id}, token not valid`);
        this.log.error('Authentication token:', req.headers.authorization.split('Bearer ').pop());
        this.log.error(req.body);

        // rediscover and reprovision panels
        if (this.ssdpDiscovering === false) {
          this.log.debug('Rediscovering and reprovisioning panels...');
          this.discoverPanels();
        }
      }
    };

    // listen for requests at the following route/endpoint
    app
      .route('/api/konnected/device/:id')
      .put(respond) // Alarm Panel V1-V2
      .post(respond) // Alarm Panel Pro
      .get(respond); // For Actuator Requests
  }

  /**
   * Register the Security System
   *
   * There are two scenarios for the security system:
   * 1. the security system logic is handled by the plugin, the installed home security system is just reporting sensor states;
   * 2. the security system logic is handled by the installed home security system.
   *
   * We provide security system logic that allows each sensor (not temperature or humidity) to define what security mode it can trigger the alarm in,
   * with the following considerations:
   * - armed away: long countdown of beeps from piezo;
   * - armed home: short countdown of beeps from piezo;
   * - armed night: no countdown beeps from piezo;
   * - disarmed: when contact sensors change state, check an option for momentary piezo beeps for change.
   */
  registerSecuritySystem() {
    const securitySystemObject = {
      UUID: this.securitySystemUUID,
      displayName: 'Konnected Alarm',
      type: 'securitysystem',
      model: 'Konnected Security System',
      serialNumber: this.api.hap.uuid.toShortForm(this.securitySystemUUID),
      state: 0,
    };

    const existingSecuritySystem = this.accessories.find((accessory) => accessory.UUID === this.securitySystemUUID);

    if (existingSecuritySystem) {
      // then the accessory already exists
      this.log.info(
        `Updating existing accessory: ${existingSecuritySystem.displayName} (${existingSecuritySystem.context.device.serialNumber})`
      );

      // store a direct reference to the initialized accessory with service and characteristics in the KonnectedPlatformAccessories object
      this.konnectedPlatformAccessories[this.securitySystemUUID] = new KonnectedPlatformAccessory(
        this,
        existingSecuritySystem
      );

      // update security system accessory in Homebridge and HomeKit
      this.api.updatePlatformAccessories([existingSecuritySystem]);
    } else {
      // otherwise we're adding a new accessory
      this.log.info(`Adding new accessory: ${securitySystemObject.displayName} (${this.securitySystemUUID})`);

      // build Homebridge/HomeKit platform accessory
      const newSecuritySystemAccessory = new this.api.platformAccessory('Konnected Alarm', this.securitySystemUUID);
      // store security system object in the platform accessory cache
      newSecuritySystemAccessory.context.device = securitySystemObject;
      // store a direct reference to the initialized accessory with service and characteristics in the KonnectedPlatformAccessories object
      this.konnectedPlatformAccessories[this.securitySystemUUID] = new KonnectedPlatformAccessory(
        this,
        newSecuritySystemAccessory
      );

      // add security system accessory to Homebridge and HomeKit
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [newSecuritySystemAccessory]);
    }
  }

  /**
   * Discover alarm panels on the network.
   * @reference https://help.konnected.io/support/solutions/articles/32000026805-discovery
   *
   * Konnected SSDP Search Targets:
   * @reference Alarm Panel V1-V2: urn:schemas-konnected-io:device:Security:1
   * @reference Alarm Panel Pro: urn:schemas-konnected-io:device:Security:2
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
              this.updateHombridgeConfig(panelUUID, panelResponseObject);

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

          // add the UUID to the deduping array
          ssdpDeviceIDs.push(panelUUID);
        }
      }
    });

    // stop discovery after a number of seconds seconds, default is 5
    setTimeout(() => {
      ssdpClient.stop();
      this.ssdpDiscovering = false;
      if (ssdpDeviceIDs.length) {
        this.log.debug('Discovery complete. Found panels:\n' + JSON.stringify(ssdpDeviceIDs, null, 2));
      } else if (this.ssdpDiscoverAttempts < 5) {
        this.ssdpDiscoverAttempts++;
        this.log.debug(
          `Discovery attempt ${this.ssdpDiscoverAttempts} could not find any panels on the network. Retrying...`
        );
        this.discoverPanels();
      } else {
        this.ssdpDiscoverAttempts = 0;
        this.log.debug(
          'Could not discover any panels on the network. Please check that your panel(s) are on the same network and that you have UPnP enabled. Visit https://help.konnected.io/support/solutions/articles/32000023644-device-discovery-troubleshooting for more information.'
        );
      }
    }, this.ssdpTimeout);
  }

  /**
   * Update Homebridge config.json with discovered panel information.
   *
   * @param panelUUID string  UUID for the panel as reported in the USN on discovery.
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   */
  updateHombridgeConfig(panelUUID: string, panelObject: PanelObjectInterface) {
    // validate panel UUID
    let validatedPanelUUID: string;
    if (uuidValidate(panelUUID)) {
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
   * Provision a Konnected panel with information to communicate with this plugin
   * and to register the zones on the panel according to their configured settings in this plugin.
   * @reference https://help.konnected.io/support/solutions/articles/32000026807-device-provisioning
   *
   * @param panelUUID string  UUID for the panel as reported in the USN on discovery.
   * @param panelObject PanelObjectInterface  The status response object of the plugin from discovery.
   * @param listenerObject object  Details object for this plugin's listening server.
   */
  provisionPanel(panelUUID: string, panelObject: PanelObjectInterface, listenerObject) {
    let panelIP: string = panelObject.ip;
    let panelPort: number = panelObject.port;
    let panelBlink = true;
    let panelName;

    // if there are panels in the plugin config
    if (typeof this.config.panels !== 'undefined') {
      // loop through the available panels
      for (const configPanel of this.config.panels) {
        // isolate specific panel and make sure there are zones in that panel
        if (configPanel.uuid === panelUUID) {
          panelIP = configPanel.ipAddress ? configPanel.ipAddress : panelObject.ip;
          panelPort = configPanel.port ? configPanel.port : panelObject.port;
          panelBlink = typeof configPanel.blink !== 'undefined' ? configPanel.blink : true;
          panelName = configPanel.name ? configPanel.name : '';
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
      platform: 'Homebridge',
    };

    const panelPayloadAccessories = this.configureZones(panelUUID, panelObject);

    const panelConfigurationPayload = {
      ...panelPayloadCore,
      ...panelPayloadAccessories,
    };

    this.log.debug(
      `Panel ${panelName} ${panelSettingsEndpoint} payload:\n` + JSON.stringify(panelConfigurationPayload, null, 2)
    );

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
   * Build the payload for assigning zone types on the panel.
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
      const zoneObjectsArray: RuntimeCacheInterface[] = [];

      // loop through the available panels
      this.config.panels.forEach((configPanel) => {
        // If there's a chipId in the panelObject, use that, or use mac address.
        // V1/V2 panels only have one interface (WiFi). Panels with chipId are Pro versions
        // with two network interfaces (WiFi & Ethernet) with separate mac addresses.
        // If one network interface goes down, the panel can fallback to the other
        // interface and the accessories lose their associated UUID, which can
        // result in duplicated accessories, half of which become non-responsive.
        const panelShortUUID: string =
          'chipId' in panelObject ? panelUUID.match(/([^-]+)$/i)![1] : panelObject.mac.replace(/:/g, '');

        // isolate specific panel and make sure there are zones in that panel
        if (configPanel.uuid === panelUUID && configPanel.zones) {
          // variable for deduping zones with the same zoneNumber
          // (use-case: if users don't use Config UI X to generate their config)
          const zonesCheck: string[] = [];

          configPanel.zones.forEach((configPanelZone) => {
            // create type interface for panelZone variable
            interface PanelZone {
              pin?: string;
              zone?: string;
              trigger?: number;
            }
            let panelZone: PanelZone = {};

            // assign the trigger value on startup
            const zoneTrigger =
              configPanelZone.switchSettings?.trigger !== undefined ? configPanelZone.switchSettings.trigger : 1;

            if ('model' in panelObject) {
              // this is a Pro panel
              // check if zone is improperly assigned as the V1-V2 panel 'out' zone
              if (configPanelZone.zoneNumber === 'out') {
                this.log.warn(
                  `Invalid Zone: Konnected Pro Alarm Panels do not have a zone named ${configPanelZone.zoneNumber}, change the zone assignment to 'alarm1', 'out1', or 'alarm2_out2'.`
                );
              } else if (ZONE_TYPES.actuators.includes(configPanelZone.zoneType)) {
                // this zone is assigned as an actuator
                // validate if zone can be an actuator/switch
                if (ZONES[configPanelZone.zoneNumber].includes(configPanelZone.zoneType)) {
                  panelZone.zone = configPanelZone.zoneNumber;
                  panelZone.trigger = zoneTrigger === 0 ? 0 : 1;
                } else {
                  this.log.warn(
                    `Invalid Zone: Konnected Pro Alarm Panels cannot have zone ${configPanelZone.zoneNumber} as an actuator/switch. Try zones 1-8, 'alarm1', 'out1', or 'alarm2_out2'.`
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
                // check if this zone is assigned as an actuator
                if (ZONE_TYPES.actuators.includes(configPanelZone.zoneType)) {
                  // validate if zone can be an actuator/switch
                  if (configPanelZone.zoneNumber < 6 || configPanelZone.zoneNumber === 'out') {
                    panelZone.pin = ZONES_TO_PINS[configPanelZone.zoneNumber];
                    panelZone.trigger = zoneTrigger === 0 ? 0 : 1;
                  } else {
                    this.log.warn(
                      `Invalid Zone: Konnected V1-V2 Alarm Panels cannot have zone ${configPanelZone.zoneNumber} as an actuator/switch. Try zones 1-5 or 'out'.`
                    );
                  }
                } else {
                  panelZone = {
                    pin: ZONES_TO_PINS[configPanelZone.zoneNumber],
                  };
                }
              } else {
                this.log.warn(
                  `Invalid Zone: Konnected V1-V2 Alarm Panels do not have a zone '${configPanelZone.zoneNumber}'. Try zones 1-6 or 'out'.`
                );
              }
            }

            // check if the panel object is not empty (this will cause a boot loop if it's empty)
            if (Object.keys(panelZone).length > 0 && configPanelZone.enabled === true) {
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

              const zoneLocation = configPanelZone.zoneLocation ? configPanelZone.zoneLocation + ' ' : '';

              // standard zone object properties
              const zoneObject: RuntimeCacheInterface = {
                UUID: zoneUUID,
                displayName: zoneLocation + TYPES_TO_ACCESSORIES[configPanelZone.zoneType][1],
                enabled: configPanelZone.enabled,
                type: configPanelZone.zoneType,
                model: panelModel + ' ' + TYPES_TO_ACCESSORIES[configPanelZone.zoneType][1],
                serialNumber: panelShortUUID + '-' + configPanelZone.zoneNumber,
                panel: panelObject,
              };
              // add invert property if configured
              if (configPanelZone.binarySensorSettings?.invert) {
                zoneObject.invert = configPanelZone.binarySensorSettings.invert;
              }
              // add audibleBeep property if configured
              if (configPanelZone.binarySensorSettings?.audibleBeep) {
                zoneObject.audibleBeep = configPanelZone.binarySensorSettings.audibleBeep;
              }
              // add trigger property if configured
              if (configPanelZone.switchSettings?.trigger) {
                zoneObject.trigger = configPanelZone.switchSettings.trigger;
              }
              // add triggerableModes property if configured
              if (configPanelZone.binarySensorSettings?.triggerableModes) {
                zoneObject.triggerableModes = configPanelZone.binarySensorSettings.triggerableModes;
              } else if (configPanelZone.switchSettings?.triggerableModes) {
                zoneObject.triggerableModes = configPanelZone.switchSettings.triggerableModes;
              }

              if (configPanelZone.enabled === true) {
                zoneObjectsArray.push(zoneObject);
                this.accessoriesRuntimeCache.push(zoneObject);

                // match this zone's UUID to the UUID of an accessory stored in the global accessories cache
                // store accessory object in an array of retained accessories that we don't want unregistered in Homebridge and HomeKit
                if (typeof this.accessories.find((accessory) => accessory.UUID === zoneUUID) !== 'undefined') {
                  retainedAccessories.push(this.accessories.find((accessory) => accessory.UUID === zoneUUID));
                }
              }
            } else {
              this.log.warn(
                `Duplicate Zone: Zone number '${configPanelZone.zoneNumber}' is assigned in two or more zones, please check your Homebridge configuration for panel with UUID ${panelUUID}.`
              );
            }
          }); // end forEach loop (zones)

          // Now attempt to register the zones as accessories in Homebridge and HomeKit
          this.registerAccessories(panelShortUUID, zoneObjectsArray, retainedAccessories);
        } else if (configPanel.uuid === panelUUID && typeof configPanel.zones === 'undefined') {
          this.registerAccessories(panelShortUUID, [], []);
        }
      }); // end forEach loop (panels)
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
   * Control the registration of panel zones as accessories in Homebridge (and HomeKit).
   *
   * @param panelShortUUID string  The panel short UUID for the panel of zones being passed in.
   * @param zoneObjectsArray array  An array of constructed zoneObjects.
   * @param retainedAccessoriesArray array  An array of retained accessory objects.
   */
  registerAccessories(panelShortUUID, zoneObjectsArray, retainedAccessoriesArray) {
    // console.log('zoneObjectsArray', zoneObjectsArray);
    // console.log('retainedAccessoriesArray:', retainedAccessoriesArray);

    // if (Array.isArray(retainedAccessoriesArray) && retainedAccessoriesArray.length > 0) {
    //   retainedAccessoriesArray.forEach((accessory) => {
    //     if (typeof accessory !== 'undefined') {
    //       this.log.debug(`Retained accessory: ${accessory.displayName} (${accessory.context.device.serialNumber})`);
    //     }
    //   });
    // }

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

    if (Array.isArray(accessoriesToRemoveArray) && accessoriesToRemoveArray.length > 0) {
      // unregister stale or missing zones/accessories in Homebridge and HomeKit
      accessoriesToRemoveArray.forEach((accessory) => {
        this.log.info(`Removing accessory: ${accessory.displayName} (${accessory.context.device.serialNumber})`);
      });
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemoveArray);
    }

    // update or create accessories
    ///////////////////////////////

    const accessoriesToUpdateArray: PlatformAccessory[] = [];
    const accessoriesToAddArray: PlatformAccessory[] = [];

    zoneObjectsArray.forEach((panelZoneObject) => {
      // find Homebridge cached accessories with the same uuid as those in the config
      const existingAccessory = this.accessories.find((accessory) => accessory.UUID === panelZoneObject.UUID);

      if (existingAccessory && existingAccessory.context.device.UUID === panelZoneObject.UUID) {
        // then the accessory already exists
        this.log.debug(
          `Updating existing accessory: ${existingAccessory.context.device.displayName} (${existingAccessory.context.device.serialNumber})`
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
        this.log.info(`Adding new accessory: ${panelZoneObject.displayName} (${panelZoneObject.serialNumber})`);

        // build Homebridge/HomeKit platform accessory
        const newAccessory = new this.api.platformAccessory(panelZoneObject.displayName, panelZoneObject.UUID);
        // store zone object in the platform accessory cache
        newAccessory.context.device = panelZoneObject;
        // store a direct reference to the initialized accessory with service and characteristics in the KonnectedPlatformAccessories object
        this.konnectedPlatformAccessories[panelZoneObject.UUID] = new KonnectedPlatformAccessory(this, newAccessory);

        accessoriesToAddArray.push(newAccessory);
      }
    });

    // after looping through, update or add...

    if (Array.isArray(accessoriesToUpdateArray) && accessoriesToUpdateArray.length > 0) {
      // update zones/accessories in Homebridge and HomeKit
      this.api.updatePlatformAccessories(accessoriesToUpdateArray);
      // set the switch to inverted state immediately after it's been added to Homebridge/HomeKit
      // accessoriesToUpdateArray.forEach((accessory) => {
      //   if (['switch'].includes(accessory.context.device.type) && accessory.context.device.invert === true) {
      //     this.actuateAccessory(accessory.UUID, true);
      //   }
      // });
    }

    if (Array.isArray(accessoriesToAddArray) && accessoriesToAddArray.length > 0) {
      // add zones/accessories to Homebridge and HomeKit
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToAddArray);
      // set the switch to inverted state immediately after it's been added to Homebridge/HomeKit
      // accessoriesToAddArray.forEach((accessory) => {
      //   if (['switch'].includes(accessory.context.device.type) && accessory.context.device.invert === true) {
      //     this.actuateAccessory(accessory.UUID, true);
      //   }
      // });
    }
  }

  /**
   * Update the cache when a panel reports a change in the sensor zone's state.
   * Panels only report state of sensors, so this will only fire for sensors and not actuators.
   *
   * @param req object  The request payload received for the zone at this plugin's listener REST endpoint.
   */
  updateSensorAccessoryState(req) {
    let panelZone = '';
    let zoneState = '';
    if ('pin' in req.body) {
      // convert a pin to a zone
      Object.entries(ZONES_TO_PINS).map(([key, value]) => {
        if (value === req.body.pin) {
          panelZone = key;
          zoneState = JSON.stringify(req.body) + ` (zone: ${panelZone})`;
        }
      });
    } else {
      // use the zone
      panelZone = req.body.zone;
      zoneState = JSON.stringify(req.body);
    }

    const zoneUUID = this.api.hap.uuid.generate(req.params.id + '-' + panelZone);

    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === zoneUUID);

    // check if the accessory already exists
    if (existingAccessory) {
      this.log.debug(`${existingAccessory.displayName} (${existingAccessory.context.device.serialNumber}):`, zoneState);

      // const defaultStateValue: boolean | number = this.config.existingAccessory.context.device.state;
      // console.log('defaultstateValue:', defaultStateValue);

      // loop through the accessories state cache and update state and service characteristic
      this.accessoriesRuntimeCache.forEach((runtimeCacheAccessory) => {
        if (runtimeCacheAccessory.UUID === zoneUUID) {
          // this is the default state for all binary switches in HomeKit
          const defaultStateValue: boolean | number = runtimeCacheAccessory.type === 'motion' ? false : 0; // 0 = false in boolean
          // incoming state from panel
          let requestStateValue: boolean | number = req.body.state;
          // result state after invert check
          let resultStateValue: boolean | number = requestStateValue;

          // we can't invert temperature or humidity sensors
          if (!['humidtemp', 'temperature'].includes(runtimeCacheAccessory.type)) {
            // invert the value if accessory is configured to have its value inverted
            if (runtimeCacheAccessory.invert === true) {
              // switch value
              requestStateValue = requestStateValue === 0 ? 1 : 0;
              // motion sensor's state is a boolean characteristic
              if (runtimeCacheAccessory.type === 'motion') {
                resultStateValue = Boolean(requestStateValue);
              }
              this.log.debug(
                `${runtimeCacheAccessory.displayName} (${runtimeCacheAccessory.serialNumber}): inverted state from '${requestStateValue}' to '${resultStateValue}'`
              );
            }

            // now check if the accessory should do something: e.g., trigger the alarm, produce an audible beep, etc.
            this.processAccessoryActions(defaultStateValue, resultStateValue, runtimeCacheAccessory);
          }

          switch (TYPES_TO_ACCESSORIES[runtimeCacheAccessory.type][0]) {
            case 'ContactSensor':
              runtimeCacheAccessory.state = resultStateValue;
              this.konnectedPlatformAccessories[runtimeCacheAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.ContactSensorState,
                resultStateValue
              );
              break;
            case 'MotionSensor':
              runtimeCacheAccessory.state = resultStateValue;
              this.konnectedPlatformAccessories[runtimeCacheAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.MotionDetected,
                resultStateValue
              );
              break;
            case 'LeakSensor':
              runtimeCacheAccessory.state = resultStateValue;
              this.konnectedPlatformAccessories[runtimeCacheAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.LeakDetected,
                resultStateValue
              );
              break;
            case 'SmokeSensor':
              runtimeCacheAccessory.state = resultStateValue;
              this.konnectedPlatformAccessories[runtimeCacheAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.SmokeDetected,
                resultStateValue
              );
              break;
            case 'TemperatureSensor':
              runtimeCacheAccessory.temp = req.body.temp;
              this.konnectedPlatformAccessories[runtimeCacheAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.CurrentTemperature,
                runtimeCacheAccessory.temp
              );
              break;
            case 'HumiditySensor':
              runtimeCacheAccessory.temp = req.body.temp;
              this.konnectedPlatformAccessories[runtimeCacheAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.CurrentTemperature,
                runtimeCacheAccessory.temp
              );
              runtimeCacheAccessory.humi = req.body.humi;
              this.konnectedPlatformAccessories[runtimeCacheAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.CurrentRelativeHumidity,
                runtimeCacheAccessory.humi
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
   * Determine if the passed in sensor accessory should do something.
   * E.g., trigger the alarm, produce an audible beep, etc.
   *
   * @param defaultStateValue boolean | number  The original default state of the accessory.
   * @param resultStateValue boolean | number  The state of the accessory as updated.
   * @param accessory RuntimeCacheInterface  The accessory that we are basing our actions by.
   */
  processAccessoryActions(
    defaultStateValue: boolean | number,
    resultStateValue: boolean | number,
    accessory: RuntimeCacheInterface
  ) {
    // if the default state of the accessory is not the same as the updated state, we should process it
    if (defaultStateValue !== resultStateValue) {
      this.log.debug(
        `${accessory.displayName} (${accessory.serialNumber}): changed from its default state of '${defaultStateValue}' to '${resultStateValue}'`
      );

      const securitySystemAccessory = this.accessories.find((accessory) => accessory.UUID === this.securitySystemUUID);

      // check if accessory should trigger the alarm (based on what set modes it should)
      if (accessory.triggerableModes?.includes(String(securitySystemAccessory?.context.device.state) as never)) {
        // accessory should trigger security system
        // find the beeper accessories and actuate them them for the audible delay sound
        this.accessoriesRuntimeCache.forEach((beeperAccessory) => {
          if (beeperAccessory.type === 'beeper') {
            const trigger = beeperAccessory.trigger ? beeperAccessory.trigger : true;

            let beeperSettings;
            if (this.config.advanced?.entryDelaySettings?.pulseDuration) {
              beeperSettings = this.config.advanced?.entryDelaySettings;
            } else {
              beeperSettings = null;
            }

            const securitySystemAccessory = this.accessories.find(
              (ssAccessory) => ssAccessory.UUID === this.securitySystemUUID
            );
            if (accessory.triggerableModes?.includes(String(securitySystemAccessory?.context.device.state) as never)) {
              this.konnectedPlatformAccessories[beeperAccessory.UUID].service.updateCharacteristic(
                this.Characteristic.On,
                true
              );
              this.actuateAccessory(beeperAccessory.UUID, trigger, beeperSettings);
            }
          }
        });
        // wait the entry delay time before triggering the security system (and sounding the siren and reporting to noomlight)
        this.entryTriggerDelayTimerHandle = setTimeout(() => {
          this.log.debug(
            `Set [${securitySystemAccessory?.context.device.displayName}] (${securitySystemAccessory?.context.device.serialNumber}) '${securitySystemAccessory?.context.device.type}' Characteristic: 4 (triggered!)`
          );
          this.triggerSecuritySystem();
        }, this.entryTriggerDelay);
      } else {
        // accessory is just sensing change
        // restrict it to contact or motion sensor accessories that have the audible notification setting configured
        if (['contact', 'motion'].includes(accessory.type) && accessory.audibleBeep) {
          this.accessoriesRuntimeCache.forEach((beeperAccessory) => {
            if (beeperAccessory.type === 'beeper') {
              const trigger = beeperAccessory.trigger ? beeperAccessory.trigger : true;
              this.actuateAccessory(beeperAccessory.UUID, trigger, null);
            }
          });
        }
      }
    }
  }

  /**
   * Actuate a zone on a panel based on the switch's state.
   *
   * @param zoneUUID string  HAP UUID for the switch zone accessory.
   * @param value boolean | number  The value to change the state of the zone accessory to.
   */
  actuateAccessory(zoneUUID: string, value: boolean | number, inboundSwitchSettings: Record<string, unknown> | null) {
    // retrieve the matching accessory
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
                // explicitly convert boolean to integer for the panel payload
                state: Number(value),
              };

              // Pro zone vs V1-V2 pin payload property assignment
              if ('model' in existingAccessory.context.device.panel) {
                // this is a Pro panel
                panelEndpoint += 'zone';
                if (ZONES[zoneObject.zoneNumber].includes('switch')) {
                  actuatorPayload.zone = zoneObject.zoneNumber;
                } else {
                  this.log.warn(
                    `Invalid Zone: Cannot actuate the zone '${zoneObject.zoneNumber}' for Konnected Pro Alarm Panels. Try zones 1-8, 'alarm1', 'out1', or 'alarm2_out2'.`
                  );
                }
              } else {
                // this is a V1-V2 panel
                panelEndpoint += 'device';
                // convert zone to a pin
                if (zoneObject.zoneNumber < 6 || zoneObject.zoneNumber === 'out') {
                  actuatorPayload!.pin = ZONES_TO_PINS[zoneObject.zoneNumber];
                } else {
                  this.log.warn(
                    `Invalid Zone: Cannot actuate the zone '${zoneObject.zoneNumber}' for Konnected V1-V2 Alarm Panels. Try zones 1-5 or 'out'.`
                  );
                }
              }

              // calculate the duration for a momentary switch to complete its triggered task (eg. sequence of pulses)
              // this calculation occurs when there are switch settings and the switch is turning 'on'
              // otherwise we simply need send a default payload of 'off'
              let actuatorDuration;
              const switchSettings = inboundSwitchSettings ? inboundSwitchSettings : zoneObject.switchSettings;
              if (switchSettings && value === true) {
                if (switchSettings.pulseDuration) {
                  actuatorPayload.momentary = actuatorDuration = switchSettings.pulseDuration;
                }
                if (switchSettings.pulseRepeat && switchSettings.pulsePause) {
                  actuatorPayload.times = switchSettings.pulseRepeat;
                  actuatorPayload.pause = switchSettings.pulsePause;
                  if (switchSettings.pulseRepeat > 0) {
                    actuatorDuration =
                      actuatorDuration * switchSettings.pulseRepeat +
                      switchSettings.pulsePause * (switchSettings.pulseRepeat - 1);
                  }
                }
              }

              this.log.debug(
                `Actuating ['${existingAccessory.displayName}'] (${existingAccessory.context.device.serialNumber}) '${existingAccessory.context.device.type}' with payload:\n` +
                  JSON.stringify(actuatorPayload, null, 2)
              );

              // send payload to panel to actuate, and if momentary, also change the switch state back after duration
              const actuatePanelZone = async (url: string) => {
                try {
                  const response = await fetch(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(actuatorPayload),
                  });
                  if (
                    response.status === 200 &&
                    ['beeper', 'siren', 'strobe', 'switch'].includes(existingAccessory.context.device.type)
                  ) {
                    if (actuatorDuration > 0 && switchSettings.pulseRepeat !== Number(-1)) {
                      // this is a momentary switch, reset the state after calculated duration
                      setTimeout(() => {
                        // if state is on, turn off
                        const restoreState = value === true ? false : true;
                        // update Homebridge/HomeKit displayed state
                        this.konnectedPlatformAccessories[zoneUUID].service.updateCharacteristic(
                          this.Characteristic.On,
                          restoreState
                        );
                        // update the state cache for subsequent HomeKit get calls
                        this.accessoriesRuntimeCache.forEach((runtimeCacheAccessory) => {
                          if (runtimeCacheAccessory.UUID === zoneUUID) {
                            runtimeCacheAccessory.state = restoreState;
                            this.log.debug(
                              `Set [${runtimeCacheAccessory.displayName}] (${runtimeCacheAccessory.serialNumber}) '${runtimeCacheAccessory.type}' characteristic value: ${restoreState}`
                            );
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

  /**
   * Arm/Disarm the security system accessory.
   *
   * @param value number  The value to change the state of the Security System accessory to.
   */
  controlSecuritySystem(value: number) {
    this.konnectedPlatformAccessories[this.securitySystemUUID].service.updateCharacteristic(
      this.Characteristic.SecuritySystemCurrentState,
      value
    );
    // turns off the trigger of beepers and sirens
    if (value === 3) {
      clearTimeout(this.entryTriggerDelayTimerHandle);
      this.accessoriesRuntimeCache.forEach((runtimeCacheAccessory) => {
        if (['beeper', 'siren', 'strobe'].includes(runtimeCacheAccessory.type)) {
          const trigger = runtimeCacheAccessory.trigger === false ? true : false;
          this.konnectedPlatformAccessories[runtimeCacheAccessory.UUID].service.updateCharacteristic(
            this.Characteristic.On,
            trigger
          );
          this.actuateAccessory(runtimeCacheAccessory.UUID, trigger, null);
        }
      });
    }
  }

  /**
   * Triggers the security system alarm based on the accessory's security system mode settings.
   * We will likely need to make a call to a NoonLight method here at some point.
   *
   * @link https://www.npmjs.com/package/@noonlight/noonlight-sdk
   */
  triggerSecuritySystem() {
    this.konnectedPlatformAccessories[this.securitySystemUUID].service.updateCharacteristic(
      this.Characteristic.SecuritySystemCurrentState,
      4
    );
    this.accessoriesRuntimeCache.forEach((alarmAccessory) => {
      if (['siren', 'strobe'].includes(alarmAccessory.type)) {
        const trigger = alarmAccessory.trigger ? alarmAccessory.trigger : true;
        this.konnectedPlatformAccessories[alarmAccessory.UUID].service.updateCharacteristic(
          this.Characteristic.On,
          true
        );
        this.actuateAccessory(alarmAccessory.UUID, trigger, null);
      }
      // corrects bug with the konnected board where it turns off continuous pulsing zones when other zones are actuated
      // for later removal
      if ('beeper' === alarmAccessory.type) {
        this.konnectedPlatformAccessories[alarmAccessory.UUID].service.updateCharacteristic(
          this.Characteristic.On,
          false
        );
      }
    });
  }
}