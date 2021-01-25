/**
 * For Pro Panel
 */
export const ZONES = {
  1: ['sensor', 'switch', 'armingswitch'],
  2: ['sensor', 'switch', 'armingswitch'],
  3: ['sensor', 'switch', 'armingswitch'],
  4: ['sensor', 'switch', 'armingswitch'],
  5: ['sensor', 'switch', 'armingswitch'],
  6: ['sensor', 'switch', 'armingswitch'],
  7: ['sensor', 'switch', 'armingswitch'],
  8: ['sensor', 'switch', 'armingswitch'],
  9: ['sensor'],
  10: ['sensor'],
  11: ['sensor'],
  12: ['sensor'],
  alarm1: ['sensor', 'switch', 'armingswitch'],
  out1: ['sensor', 'switch', 'armingswitch'],
  alarm2_out2: ['sensor', 'switch', 'armingswitch'],
};

/**
 * For V1/V2 Panels
 */
export const ZONES_TO_PINS = {
  1: 1,
  2: 2,
  3: 5,
  4: 6,
  5: 7,
  6: 9,
  out: 8,
};

/**
 * For Zone Logic
 */
export const ZONE_TYPES = {
  sensors: [
    'contact',
    'motion',
    'glass',
    'water',
    'smoke',
  ],
  dht_sensors: [
    'humidtemp',
  ],
  ds18b20_sensors: [
    'temperature',
  ],
  actuators: [
    'armingswitch',
    'siren',
    'strobe',
    'switch',
  ],
};

export const ZONE_TYPES_TO_ACCESSORIES = {
  contact: 'ContactSensor',                // https://developers.homebridge.io/#/service/ContactSensor
  motion: 'MotionSensor',                  // https://developers.homebridge.io/#/service/MotionSensor
  glass: 'ContactSensor',                  // https://developers.homebridge.io/#/service/ContactSensor
  water: 'LeakSensor',                     // https://developers.homebridge.io/#/service/LeakSensor
  smoke: 'SmokeSensor',                    // https://developers.homebridge.io/#/service/SmokeSensor
  temperature: 'TemperatureSensor',        // https://developers.homebridge.io/#/service/TemperatureSensor
  humidtemp: 'HumiditySensor',             // https://developers.homebridge.io/#/service/HumiditySensor
  armingswitch: 'Switch',                  // https://developers.homebridge.io/#/service/SecuritySystem
  siren: 'Switch',                         // https://developers.homebridge.io/#/service/Switch
  strobe: 'Switch',                        // https://developers.homebridge.io/#/service/Switch
  switch: 'Switch',                        // https://developers.homebridge.io/#/service/Switch
};

export const ZONE_TYPES_TO_NAMES = {
  contact: 'Contact Sensor',
  motion: 'Motion Sensor',
  glass: 'Glass Break Sensor',
  water: 'Water Sensor',
  smoke: 'Smoke Sensor',
  temperature: 'Temperature Sensor',
  humidtemp: 'Humidity & Temperature Sensor',
  armingswitch: 'Alarm Switch',
  siren: 'Alarm Siren',
  strobe: 'Alarm Strobe Light',
  switch: 'Generic Switch',
};