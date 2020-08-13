import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM, PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { KonnectedPlatformAccessory } from './platformAccessory';

import http from 'http';        // for creating a listening server
import ip from 'ip';            // for getting system active IP
import express from 'express';  // for the listening API
import client from 'node-ssdp'; // for devices discovery
import fetch from 'node-fetch'; // for making calls to the device

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class KonnectedHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly Accessory: typeof PlatformAccessory = this.api.platformAccessory;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  // define shared variables here
  public platform: string = this.config.platform || PLATFORM; // konnected
  public platformName: string = this.config.name || PLATFORM_NAME;// Konnected
  public pluginName: string = this.config.pluginName || PLUGIN_NAME; // homebridge-konnected
  public listenerAddress: string = ip.address();
  public listenerPort!: number;
  

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.log.debug('Finished initializing platform');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');

      // run the method to discover / register your devices as accessories
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
   */
  listeningServer() {

    const app = express();
    const server = http.createServer(app);

    this.listenerPort = this.config.listenerPort || 0;


    server.listen(this.listenerPort, () => {
      // store port to its global variable
      this.listenerPort = server!.address()!['port'];
      this.log.info(`Listening for zone changes on ${ip.address()} port ${this.listenerPort}`);
    });

    // restart or crash cleanup
    const cleanup = () => {
      server.on('close', () => {
        process.exit(0);
      });
      server.close();
      this.log.info(`Listening port ${this.listenerPort} closed and released`);
    };
    process.on('SIGINT', cleanup).on('SIGTERM', cleanup);


    app.put('/api/konnected/device/:id', (req, res) => {
      
      this.log.info(req.params.id);

      // check to see if that id exists

      res.json({'success': true});

      // state change logic (either call or code)

    });


  }

  /**
   * Discovers alarm panels on the network.
   */
  discoverPanels() {

    const ssdpClient = new client.Client();
    const ssdpTimeout = (this.config.discoveryTimeout || 10) * 1000;
    const ssdpUrnPartial = 'urn:schemas-konnected-io:device';
    // urn:schemas-konnected-io:device:Security:1 // Alarm Panel
    // urn:schemas-konnected-io:device:Security:2 // Alarm Panel Pro

    let ssdpHeaderST: string;
    let sspdHeaderLocation: string;

    // const konnectPanels = [];

    // set up our ssdp discovery
    ssdpClient.on('response', (headers, statusCode, response) => {

      ssdpHeaderST = headers['ST'] || '';
      sspdHeaderLocation = headers['LOCATION'] || '';

      if (ssdpHeaderST.indexOf(ssdpUrnPartial) !== -1) {

        console.log(headers);
        console.log(response);
        this.log.info(sspdHeaderLocation.replace('Device.xml', 'status'));

        (async () => {

          const fetchResponse = await fetch(sspdHeaderLocation.replace('Device.xml', 'status'));
          const fetchBody = JSON.parse(await fetchResponse.text());
          console.log(fetchBody);

          // konnectPanels.push(
          //   { }
          // );

        })();

      }

    });

    ssdpClient.search('ssdp:all');
    // if we don't find a connection in 30 seconds, stop discovery
    
    setTimeout(() => {
      ssdpClient.stop();
    }, ssdpTimeout);

  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverZones(panelsObject: object) {

    // EXAMPLE ONLY
    // A real plugin you would discover accessories from the local network, cloud services
    // or a user-defined array in the platform config.
    const exampleDevices = [
      {
        exampleUniqueId: 'ABCD',
        exampleDisplayName: 'Bedroom',
      },
      {
        exampleUniqueId: 'EFGH',
        exampleDisplayName: 'Kitchen',
      },
    ];

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of exampleDevices) {

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.exampleUniqueId);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new KonnectedPlatformAccessory(this, existingAccessory);

      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.exampleDisplayName);

        // create a new accessory
        const accessory = new this.Accessory(device.exampleDisplayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new KonnectedPlatformAccessory(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM, [accessory]);
      }

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM, [accessory]);
    }

  }

}
