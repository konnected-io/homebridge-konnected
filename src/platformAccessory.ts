import { Service, PlatformAccessory, CharacteristicGetCallback } from 'homebridge';

// import { ZONE_TYPES_TO_ACCESSORIES } from './constants';
import { KonnectedHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class KonnectedPlatformAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private binarySensorState = {
    ContactSensorState: 1,
  }

  constructor(
    private readonly platform: KonnectedHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLATFORM_NAME)
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.SerialNumber);
    // .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.FirmwareVersion)
    // .setCharacteristic(this.platform.Characteristic.HardwareRevision, accessory.context.device.HardwareRevision)

    // get the device service if it exists, otherwise create a new device service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.ContactSensor) || this.accessory.addService(this.platform.Service.ContactSensor);

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the Open/Closed Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .on('get', this.getState.bind(this)); // GET - bind to the `getState` method below

    this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, 1);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getState(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const isOpen = this.binarySensorState.ContactSensorState;

    this.platform.log.debug(
      `Get [${this.accessory.context.device.displayName}] 'ContactSensorState' Characteristic -> ${isOpen}`
    );

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, isOpen);
  }

}
