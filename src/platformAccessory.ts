import { Service, PlatformAccessory, CharacteristicGetCallback } from 'homebridge';
import { ZONE_TYPES_TO_ACCESSORIES } from './constants';

// import { ZONE_TYPES_TO_ACCESSORIES } from './constants';
import { KonnectedHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory registered
 */
export class KonnectedPlatformAccessory {
  private service: Service;

  constructor(private readonly platform: KonnectedHomebridgePlatform, private readonly accessory: PlatformAccessory) {
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Konnected')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.serialNumber);
    // .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.FirmwareVersion)
    // .setCharacteristic(this.platform.Characteristic.HardwareRevision, accessory.context.device.HardwareRevision)

    // get the device service if it exists, otherwise create a new device service
    this.service =
      this.accessory.getService(this.platform.Service[ZONE_TYPES_TO_ACCESSORIES[this.accessory.context.device.type]]) ||
      this.accessory.addService(this.platform.Service[ZONE_TYPES_TO_ACCESSORIES[this.accessory.context.device.type]]);

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    switch (ZONE_TYPES_TO_ACCESSORIES[accessory.context.device.type]) {
      case 'ContactSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .on('get', this.getContactSensorState.bind(this));
        break;
      case 'MotionSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.MotionDetected)
          .on('get', this.getMotionSensorState.bind(this));
        break;
      case 'LeakSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.LeakDetected)
          .on('get', this.getLeakSensorState.bind(this));
        break;
      case 'SmokeSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.SmokeDetected)
          .on('get', this.getSmokeSensorState.bind(this));
        break;
      case 'TemperatureSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
          .on('get', this.getTemperatureSensorValue.bind(this));
        break;
      case 'HumiditySensor':
        // DHT sensors have both humidity and temperature
        this.service
          .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
          .on('get', this.getHumiditySensorValue.bind(this));
        // add temperature as secondary service
        this.service.addOptionalCharacteristic(this.platform.Characteristic.CurrentTemperature);
        this.service =
          this.accessory.getService(this.platform.Service.TemperatureSensor) ||
          this.accessory.addService(this.platform.Service.TemperatureSensor);
        this.service
          .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
          .on('get', this.getTemperatureSensorValue.bind(this));
        break;

      case 'Switch':
        this.service
          .getCharacteristic(this.platform.Characteristic.On)
          .on('get', this.getSwitchValue.bind(this))
          .on('set', this.setSwitchValue.bind(this));
        break;

      default:
        break;
    }

    // set the accessory's default name in the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);
  }

  /**
   * Gets the state of the accessory from the state cache.
   */
  getAccessoryState(accessoryUUID: string, stateType: string) {
    let value;

    this.platform.zoneStatesRuntimeCache.forEach((accessory) => {
      if (accessory.UUID === accessoryUUID) {
        this.platform.log.debug(
          `Get [${accessory.displayName}] '${stateType}' Characteristic: ${accessory[stateType]}`
        );

        if (typeof accessory[stateType] === 'undefined') {
          this.platform.log.debug(
            `Assigning default state 0 to [${this.accessory.context.device.displayName}] '${
              ZONE_TYPES_TO_ACCESSORIES[this.accessory.context.device.type]
            }' Characteristic. Awaiting zone's first state change...`
          );
          if (stateType === 'switch') {
            accessory[stateType] = value = false;
          } else {
            accessory[stateType] = value = 0;
          }
          
        } else {
          value = Number(accessory[stateType]);
        }
      }
    });
    return value;
  }

  /**
   * Sets the state of the accessory in the state cache.
   */
  setAccessoryState(accessoryUUID: string, stateType: string, value) {
    this.platform.zoneStatesRuntimeCache.forEach((accessory) => {
      if (accessory.UUID === accessoryUUID) {
        this.platform.log.debug(
          `Set [${this.accessory.context.device.displayName}] 'Switch' Characteristic: ${accessory[stateType]}`
        );
        accessory[stateType] = value;
      }
    });
    this.platform.actuateAccessory(accessoryUUID, value);
    return value;
  }

  /**
   * Handle the "GET" & "SET" requests from HomeKit
   */
  getContactSensorState(callback: CharacteristicGetCallback) {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'state');
    callback(null, state);
  }

  getMotionSensorState(callback: CharacteristicGetCallback) {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'state');
    callback(null, state);
  }

  getLeakSensorState(callback: CharacteristicGetCallback) {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'state');
    callback(null, state);
  }

  getSmokeSensorState(callback: CharacteristicGetCallback) {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'state');
    callback(null, state);
  }

  getTemperatureSensorValue(callback: CharacteristicGetCallback) {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'temp');
    callback(null, state);
  }

  getHumiditySensorValue(callback: CharacteristicGetCallback) {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'humi');
    callback(null, state);
  }

  getSwitchValue(callback: CharacteristicGetCallback) {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'switch');
    callback(null, state);
  }

  setSwitchValue(value, callback: CharacteristicGetCallback) {
    const state = this.setAccessoryState(this.accessory.context.device.UUID, 'switch', value);
    callback(null);
  }
}