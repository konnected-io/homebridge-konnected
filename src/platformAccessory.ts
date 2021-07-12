import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { TYPES_TO_ACCESSORIES } from './constants';
import { KonnectedHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory registered
 */
export class KonnectedPlatformAccessory {
  private service: Service;
  private accessoryServiceType: string;
  private temperatureSensorService;

  constructor(private readonly platform: KonnectedHomebridgePlatform, private readonly accessory: PlatformAccessory) {
    // translate the accessory type to the service type
    this.accessoryServiceType = TYPES_TO_ACCESSORIES[this.accessory.context.device.type][0];

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
      this.accessory.getService(this.platform.Service[this.accessoryServiceType]) ||
      this.accessory.addService(this.platform.Service[this.accessoryServiceType]);

    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id.
    // For example:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the accessory's default name in the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    switch (this.accessoryServiceType) {
      case 'SecuritySystem':
        this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
          .onGet(this.getSecuritySystemCurrentState.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
          .onGet(this.getSecuritySystemTargetState.bind(this))
          .onSet(this.setSecuritySystemTargetState.bind(this));
        break;

      case 'ContactSensor':
        this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(this.getContactSensorState.bind(this));
        break;

      case 'MotionSensor':
        this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
          .onGet(this.getMotionSensorState.bind(this));
        break;

      case 'LeakSensor':
        this.service.getCharacteristic(this.platform.Characteristic.LeakDetected)
          .onGet(this.getLeakSensorState.bind(this));
        break;

      case 'SmokeSensor':
        this.service.getCharacteristic(this.platform.Characteristic.SmokeDetected)
          .onGet(this.getSmokeSensorState.bind(this));
        break;

      case 'TemperatureSensor':
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
          .onGet(this.getTemperatureSensorValue.bind(this));
        break;

      case 'HumiditySensor': {
        // this represents DHT sensors
        this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
          .onGet(this.getHumiditySensorValue.bind(this));
        // the primary accessory is the humidity sensor and we need to add the secondary service/accessory as the temperature sensor
        // this will unconditionally create a HAP warning on creation, but not after further restarts
        this.temperatureSensorService = this.accessory.getService('Temperature Sensor') ||
          this.accessory
            .addService(this.platform.Service.TemperatureSensor, 'Temperature Sensor', accessory.context.device.serialNumber + '.1')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.serialNumber + '.1');
        break;
      }

      case 'Switch':
        this.service.getCharacteristic(this.platform.Characteristic.On)
          .onGet(this.getSwitchState.bind(this))
          .onSet(this.setSwitchState.bind(this));
        break;

      default:
        break;
    }
  }

  /**
   * Handle the "GET" & "SET" requests from HomeKit
   */
  async getSecuritySystemCurrentState(): Promise<CharacteristicValue> {
    const state = this.getSecuritySystemState(this.accessory.context.device.UUID, 'current');
    return state as number;
  }

  async getSecuritySystemTargetState(): Promise<CharacteristicValue> {
    const state = this.getSecuritySystemState(this.accessory.context.device.UUID, 'target');
    return state as number;
  }

  async setSecuritySystemTargetState(value: CharacteristicValue) {
    this.setSecuritySystemState(this.accessory.context.device.UUID, 'target', value as number);
  }

  async getContactSensorState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'contact');
    return state as number;
  }

  async getMotionSensorState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'motion');
    return state as boolean;
  }

  async getLeakSensorState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'water');
    return state as number;
  }

  async getSmokeSensorState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'smoke');
    return state as number;
  }

  async getTemperatureSensorValue(): Promise<CharacteristicValue> {
    const temp = this.getAccessoryState(this.accessory.context.device.UUID, 'temp');
    return temp as number;
  }

  async getHumiditySensorValue(): Promise<CharacteristicValue> {
    const humi = this.getAccessoryState(this.accessory.context.device.UUID, 'humi');
    return humi as number;
  }

  async getSwitchState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState(this.accessory.context.device.UUID, 'switch');
    return state as boolean;
  }

  async setSwitchState(value: CharacteristicValue) {
    this.setAccessoryState(this.accessory.context.device.UUID, 'switch', value as boolean);
  }

  // get and set the security system states
  getSecuritySystemState(ssUUID: string, characteristic: string) {
    let value = 0; // default to Home (in case of catastrophic reset when not home, this preserves the home's security)
    this.platform.accessories.forEach((accessory) => {
      if (accessory.UUID === ssUUID) {
        // set defaults
        if (typeof accessory.context.device.state === 'undefined') {
          accessory.context.device.state = value;
          this.platform.log.debug(
            `Assigning default state '${value}' to [${this.accessory.context.device.displayName}] (${this.accessory.context.device.serialNumber}) '${this.accessoryServiceType}' characteristic value. Awaiting zone's first state change...`
          );
        } else {
          value = accessory.context.device.state;
        }
        this.platform.log.debug(
          `Get [${accessory.displayName}] (${accessory.context.device.serialNumber}) '${accessory.context.device.type}' ${characteristic} characteristic value: ${accessory.context.device.state}`
        );
      }
    });
    return value;
  }

  setSecuritySystemState(ssUUID: string, characteristic: string, value: number) {
    this.platform.accessories.forEach((accessory) => {
      if (accessory.UUID === ssUUID) {
        this.accessory.context.device.state = value;
        this.platform.log.debug(
          `Set [${this.accessory.context.device.displayName}] (${this.accessory.context.device.serialNumber}) '${this.accessory.context.device.type}' ${characteristic} characteristic value: ${value}`
        );
      }
    });
    this.platform.controlSecuritySystem(value);
    return value;
  }

  // get sensor or actuator state
  getAccessoryState(accessoryUUID: string, type: string) {
    let value: number | boolean | undefined;

    this.platform.accessoriesRuntimeCache.forEach((runtimeCacheAccessory) => {
      if (runtimeCacheAccessory.UUID === accessoryUUID) {
        let debugDefault = '';

        // accessory with basic state: set default or get property values
        if (typeof runtimeCacheAccessory.state === 'undefined') {
          // handle boolean vs number properties
          if (['motion', 'switch'].includes(type)) {
            // these are boolean in HomeKit
            runtimeCacheAccessory.state = value = false;
            debugDefault = 'default ';
          } else if (['contact', 'water', 'smoke'].includes(type)) {
            // these are numeric in HomeKit
            runtimeCacheAccessory.state = value = 0;
          }
        } else {
          if (['motion', 'switch'].includes(type)) {
            value = Boolean(runtimeCacheAccessory.state);
            debugDefault = 'default ';
          } else if (['contact', 'water', 'smoke'].includes(type)) {
            value = runtimeCacheAccessory.state;
          }
        }

        // humidity accessory: set default or get property values
        if (type === 'humi') {
          if (typeof runtimeCacheAccessory.humi === 'undefined') {
            runtimeCacheAccessory.humi = value = 0;
            debugDefault = 'default ';
          } else {
            value = runtimeCacheAccessory.humi;
          }
          // now get and update the temperature accessory
          const temperature = this.getAccessoryState(accessoryUUID, 'temp');
          this.temperatureSensorService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temperature as number);
        }

        // temperature accessory: set default or get property values
        if (type === 'temp') {
          if (typeof runtimeCacheAccessory.temp === 'undefined') {
            runtimeCacheAccessory.temp = value = 0;
            debugDefault = 'default ';
          } else {
            value = runtimeCacheAccessory.temp;
          }
        }

        const logtype = type !== runtimeCacheAccessory.type ? '-'+type : '';

        this.platform.log.debug(
          `Get ${debugDefault}[${runtimeCacheAccessory.displayName}] (${runtimeCacheAccessory.serialNumber}) '${runtimeCacheAccessory.type}${logtype}' characteristic value: ${value}`
        );
      }
    });
    return value;
  }

  // for actuators
  setAccessoryState(accessoryUUID: string, type: string, value: boolean | number) {
    this.platform.actuateAccessory(accessoryUUID, value, null);
    return value;
  }
}