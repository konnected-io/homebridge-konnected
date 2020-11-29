import { Service, PlatformAccessory, CharacteristicGetCallback } from 'homebridge';

// import { ZONE_TYPES_TO_ACCESSORIES } from './constants';
import { KonnectedHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory registered
 */
export class KonnectedPlatformAccessory {
  private service: Service;

  constructor(
    private readonly platform: KonnectedHomebridgePlatform,
    private readonly accessory: PlatformAccessory
  ) {
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Konnected')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.serialNumber);
    // .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.FirmwareVersion)
    // .setCharacteristic(this.platform.Characteristic.HardwareRevision, accessory.context.device.HardwareRevision)

    
    
    
    // Logic here to determine what kind of accessory it is based on accessory.context.device.type referencing ZONE_TYPES_TO_ACCESSORIES
    // for now we are just able to make them contact sensors



    // get the device service if it exists, otherwise create a new device service
    this.service =
      this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the accessory's default name in the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    // register handlers for the state, Homekit will call this periodically
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState).on('get', this.getState.bind(this)); // GET - bind to the `getState` method below

    // this.service
    //   .getCharacteristic(this.platform.Characteristic.ContactSensorState)
    //   .updateValue(accessory.context.device.state);
  }

  /**
   * Handle the "GET" requests from HomeKit
   */
  getState(callback: CharacteristicGetCallback) {
    // implement your own code to check if the device is on
    const state = 0;

    this.platform.log.debug(`Get [${this.accessory.context.device.displayName}] 'ContactSensorState' Characteristic: ${state}`);

    callback(null, state);
  }
}
