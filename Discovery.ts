var urn= "urn:schemas-konnected-io:device:Security:1";
var device_ip;
var device_port;
var st_header;
var device_url;

var Client = require('node-ssdp').Client
    ,client = new Client();

    client.on('response', function (headers, statusCode, rinfo) {
  
        device_ip = rinfo["address"];
        device_port = rinfo["port"];
        st_header = headers["ST"];
        device_url = headers["LOCATION"].replace("/Device.xml","");
  
        if(urn==st_header)
        {
          console.log("Konnected Device Found ",device_url);
            client.stop();
        };
     
      });

    client.search(urn);

    setTimeout(function() {
  client.stop();
}, 1000)