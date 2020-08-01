const urn= "urn:schemas-konnected-io:device:Security:1";
let device_ip,
    device_port,
    st_header,
    device_url;

let Client = require('node-ssdp').Client
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