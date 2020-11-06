/**
 * For Pro Panel
 */
export const ZONES = [
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  'alarm1',
  'out1',
  'alarm2_out2',
  'out',
];

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

export const ZONE_TYPES = {
  sensors: [
    'contact',
    'motion',
    'glass',
    'water',
    'smoke',
  ],
  dht_sensors: [
    'temperature',
  ],
  ds18b20_sensors: [
    'temphumid',
    'temperature_humidity',
  ],
  actuators: [
    'siren',
    'strobe',
    'switch',
  ],
};

export const ZONE_TYPES_TO_ACCESSORIES = {
  contact: 'ContactSensor',               // https://developers.homebridge.io/#/service/ContactSensor
  motion: 'MotionSensor',                 // https://developers.homebridge.io/#/service/MotionSensor
  glass: 'ContactSensor',                 // https://developers.homebridge.io/#/service/ContactSensor
  water: 'LeakSensor',                    // https://developers.homebridge.io/#/service/LeakSensor
  smoke: 'SmokeSensor',                   // https://developers.homebridge.io/#/service/SmokeSensor
  temperature: 'TemperatureSensor',       // https://developers.homebridge.io/#/service/TemperatureSensor
  temphumid: 'HumiditySensor',            // https://developers.homebridge.io/#/service/HumiditySensor
  temperature_humidity: 'HumiditySensor', // https://developers.homebridge.io/#/service/HumiditySensor
  siren: 'Speaker',                       // https://developers.homebridge.io/#/service/Speaker
  strobe: 'Lightbulb',                    // https://developers.homebridge.io/#/service/Lightbulb
  switch: 'Switch',                       // https://developers.homebridge.io/#/service/Switch
};

export const ZONE_TYPES_TO_NAMES = {
  contact: 'Contact Sensor',
  motion: 'Motion Sensor',
  glass: 'Glass Break Sensor',
  water: 'Water Sensor',
  smoke: 'Smoke Sensor',
  temperature: 'Temperature Sensor',
  temphumid: 'Humidity Sensor',
  temperature_humidity: 'Humidity Sensor',
  siren: 'Alarm Siren',
  strobe: 'Alarm Strobe Light',
  switch: 'Switch',
};