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
  private validSecuritySystemStates: number[];

  constructor(private readonly platform: KonnectedHomebridgePlatform, private readonly accessory: PlatformAccessory) {
    // translate the accessory type to the service type
    this.accessoryServiceType = TYPES_TO_ACCESSORIES[this.accessory.context.device.type][0];

    this.validSecuritySystemStates = [];

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
        {
          // default/required security system modes for HomeKit app
          this.validSecuritySystemStates = [
            this.platform.Characteristic.SecuritySystemTargetState.DISARM,
            this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM,
            // this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM,
            // this.platform.Characteristic.SecuritySystemTargetState.NIGHT_ARM,
          ];
          let stayHomeModeUsed = false;
          let nightModeUsed    = false;
          // find which security system modes are required/set by sensors and switches
          this.platform.accessories.forEach((existingAccessory) => {
            if (existingAccessory.context.device.triggerableModes?.includes('0')) { // stay/home
              stayHomeModeUsed = true;
              this.platform.log.debug(
                `[${existingAccessory.displayName}] (${existingAccessory.context.device.serialNumber}) '${existingAccessory.context.device.type}' has Stay/Home Mode triggerable.`
              );
            }
            if (existingAccessory.context.device.triggerableModes?.includes('2')) { // night
              nightModeUsed = true;
              this.platform.log.debug(
                `[${existingAccessory.displayName}] (${existingAccessory.context.device.serialNumber}) '${existingAccessory.context.device.type}' has Night Mode triggerable.`
              );
            }
          });
          if (stayHomeModeUsed) {
            this.validSecuritySystemStates.push(this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM);
          }
          if (nightModeUsed) {
            this.validSecuritySystemStates.push(this.platform.Characteristic.SecuritySystemTargetState.NIGHT_ARM);
          }

          const validValues = this.validSecuritySystemStates;

          this.service
            .getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
            .onGet(this.getSecuritySystemCurrentState.bind(this));
          this.service
            .getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
            .setProps({ validValues })
            .onGet(this.getSecuritySystemTargetState.bind(this))
            .onSet(this.setSecuritySystemTargetState.bind(this));
        }
        break;

      case 'ContactSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(this.getContactSensorState.bind(this));
        break;

      case 'MotionSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.MotionDetected)
          .onGet(this.getMotionSensorState.bind(this));
        break;

      case 'LeakSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.LeakDetected)
          .onGet(this.getLeakSensorState.bind(this));
        break;

      case 'SmokeSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.SmokeDetected)
          .onGet(this.getSmokeSensorState.bind(this));
        break;

      case 'TemperatureSensor':
        this.service
          .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
          .onGet(this.getTemperatureSensorValue.bind(this));
        break;

      case 'HumiditySensor':
        {
          // this represents DHT sensors
          this.service
            .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
            .onGet(this.getHumiditySensorValue.bind(this));
          // the primary accessory is the humidity sensor and we need to add the secondary service/accessory as the temperature sensor
          // this will unconditionally create a HAP warning on creation, but not after further restarts
          this.temperatureSensorService =
            this.accessory.getService('Temperature Sensor') ||
            this.accessory
              .addService(
                this.platform.Service.TemperatureSensor,
                'Temperature Sensor',
                accessory.context.device.serialNumber + '.1'
              )
              .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.serialNumber + '.1');
        }
        break;

      case 'Switch':
        this.service
          .getCharacteristic(this.platform.Characteristic.On)
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
    const state = this.getSecuritySystemState('current');
    return state as number;
  }

  async getSecuritySystemTargetState(): Promise<CharacteristicValue> {
    const state = this.getSecuritySystemState('target');
    return state as number;
  }

  async setSecuritySystemTargetState(value: CharacteristicValue) {
    this.setSecuritySystemState('target', value as number);
  }

  async getContactSensorState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState('contact');
    return state as number;
  }

  async getMotionSensorState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState('motion');
    return state as boolean;
  }

  async getLeakSensorState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState('water');
    return state as number;
  }

  async getSmokeSensorState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState('smoke');
    return state as number;
  }

  async getTemperatureSensorValue(): Promise<CharacteristicValue> {
    const temp = this.getAccessoryState('temp');
    return temp as number;
  }

  async getHumiditySensorValue(): Promise<CharacteristicValue> {
    const humi = this.getAccessoryState('humi');
    return humi as number;
  }

  async getSwitchState(): Promise<CharacteristicValue> {
    const state = this.getAccessoryState('switch');
    return state as boolean;
  }

  async setSwitchState(value: CharacteristicValue) {
    this.setAccessoryState('switch', value as boolean);
  }

  // get and set the security system states
  getSecuritySystemState(characteristic: string) {
    let value = 1; // default to Away (in case of catastrophic reset when not home, this preserves the home's security)
    // set default as 1, if there's no previous accessory state in Homebridge cache
    // or if the secuity system state exists but isn't a valid value for the states available
    // e.g., if the system was set to Home (0), but Home is not a state that is available
    // because the user didn't want or choose it for any of the sensors to trigger in
    if (
      typeof this.accessory.context.device.state === 'undefined' ||
      !this.validSecuritySystemStates.includes(this.accessory.context.device.state)
    ) {
      this.accessory.context.device.state = value;
      this.platform.log.debug(
        `Assigning default state '${value}' to [${this.accessory.context.device.displayName}] (${this.accessory.context.device.serialNumber}) '${this.accessoryServiceType}' characteristic value. Awaiting zone's first state change...`
      );
    } else {
      value = this.accessory.context.device.state;
    }
    this.platform.log.debug(
      `Get [${this.accessory.displayName}] (${this.accessory.context.device.serialNumber}) '${this.accessory.context.device.type}' ${characteristic} characteristic value: ${this.accessory.context.device.state}`
    );
    return value;
  }

  setSecuritySystemState(characteristic: string, value: number) {
    this.accessory.context.device.state = value;
    this.platform.log.debug(
      `Set [${this.accessory.context.device.displayName}] (${this.accessory.context.device.serialNumber}) '${this.accessory.context.device.type}' ${characteristic} characteristic value: ${value}`
    );
    this.platform.controlSecuritySystem(value);
    return value;
  }

  // get sensor or actuator state
  getAccessoryState(type: string) {
    let value: number | boolean | undefined;

    this.platform.accessoriesRuntimeCache.forEach((runtimeCacheAccessory) => {
      if (runtimeCacheAccessory.UUID === this.accessory.context.device.UUID) {
        let logLabelDefault = '';
        const logLabelType = type !== runtimeCacheAccessory.type ? '-' + type : '';

        // boolean-binary accessory - these are boolean in HomeKit
        if ('motion' === type || 'switch' === type) {
          if (typeof runtimeCacheAccessory.state !== 'boolean') {
            runtimeCacheAccessory.state = this.accessory.context.device.state = value = false;
            logLabelDefault = 'default ';
          } else {
            value = this.accessory.context.device.state = Boolean(runtimeCacheAccessory.state);
          }
        }

        // numeric-binary accessory - these are numeric in HomeKit
        if ('contact' === type || 'water' === type || 'smoke' === type) {
          if (typeof runtimeCacheAccessory.state !== 'number') {
            runtimeCacheAccessory.state = this.accessory.context.device.state = value = 0;
            logLabelDefault = 'default ';
          } else {
            value = this.accessory.context.device.state = Number(runtimeCacheAccessory.state);
          }
        }

        // humidity accessory (also re-gets temperature)
        if ('humi' === type) {
          if (typeof runtimeCacheAccessory.humi !== 'number') {
            runtimeCacheAccessory.humi = this.accessory.context.device.humi = value = 0;
            logLabelDefault = 'default ';
          } else {
            value = this.accessory.context.device.humi = Number(runtimeCacheAccessory.humi);
          }
          // now get and update the temperature accessory
          const temperature = this.getAccessoryState('temp');
          this.temperatureSensorService.updateCharacteristic(
            this.platform.Characteristic.CurrentTemperature,
            Number(temperature)
          );
        }

        // temperature accessory
        if ('temp' === type) {
          if (typeof runtimeCacheAccessory.temp !== 'number') {
            runtimeCacheAccessory.temp = this.accessory.context.device.temp = value = 0;
            logLabelDefault = 'default ';
          } else {
            value = this.accessory.context.device.temp = Number(runtimeCacheAccessory.temp);
          }
        }

        this.platform.log.debug(
          `Get ${logLabelDefault}[${runtimeCacheAccessory.displayName}] (${runtimeCacheAccessory.serialNumber}) '${runtimeCacheAccessory.type}${logLabelType}' characteristic value: ${value}`
        );
      }
    });
    return value;
  }

  // for actuators
  setAccessoryState(type: string, value: boolean) {
    this.platform.accessoriesRuntimeCache.forEach((runtimeCacheAccessory) => {
      if (runtimeCacheAccessory.UUID === this.accessory.context.device.UUID) {
        runtimeCacheAccessory.state = this.accessory.context.device.state = value;
        this.platform.actuateAccessory(this.accessory.context.device.UUID, value, null);
        this.platform.log.debug(
          `Set [${runtimeCacheAccessory.displayName}] (${runtimeCacheAccessory.serialNumber}) '${runtimeCacheAccessory.type}' characteristic value: ${value}`
        );
      }
    });
    return value;
  }
}