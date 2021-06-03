
const serviceUuid = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const txCharacteristicUuid = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const rxCharacteristicUuid = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

const cmdAtScan = 'AT+SCAN\n';
const cmdAtInfo = 'AT+INFO\n';

const scan_start_regex = /^\+SCAN: (\d+)\n/i;
const info_start_regex = /^\+INFO:\s(.+)/i;
const ok_regex = /\nOK\n$/i;
const error_regex = /^ERROR: (\d+)\n$/i;

const wavelengths = range(750, 1050);

const SHA256_LENGTH = 32

const spectraPlotLayout = {
  title: 'Sensor measurements',
  showlegend: false,
  xaxis: {
    title: {
      text: 'Wavelength (nm)',
    },
    tickmode: "array",
    tickvals: [750,800,850,900,950,1000,1050]
  },
  yaxis: {
    title: {
      text: 'Reflectance',
    }
  }
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/* Connected device */
var connected_device;

/* TX characteristic */
var txCharacteristic;

/* RX characteristic */
var rxCharacteristic;

/* Name of the AT command that is currently running or null */
var operationInProgress = null;

/* Buffer to collect fragmented notification messages */
var notification_buffer;

/* Length of a AT+SCAN response as specified in the start of the response */
var expected_scan_response_length;

/* Last sucessfully calibrated sensor measurement */
var calibratedMeasurements = [];

function isWebBluetoothEnabled() {
  if (navigator.bluetooth) {
    return true;
  } else {
    return false;
  }
}

function range(start, end, step = 1) {
  const len = Math.floor((end - start) / step) + 1
  return Array(len).fill().map((_, idx) => start + (idx * step))
}

function ascii_to_hexa(str) {
  var arr1 = [];
  for (var n = 0, l = str.length; n < l; n ++) {
    var hex = ('0' + Number(str.charCodeAt(n)).toString(16)).slice(-2);
    arr1.push(hex);
  }
  return arr1.join('');
}

// Source: https://stackoverflow.com/questions/16363419/how-to-get-binary-string-from-arraybuffer

function StringToArrayBuffer(string) {
    return StringToUint8Array(string).buffer;
}

function StringToBinary(string) {
    var chars, code, i, isUCS2, len, _i;

    len = string.length;
    chars = [];
    isUCS2 = false;
    for (i = _i = 0; 0 <= len ? _i < len : _i > len; i = 0 <= len ? ++_i : --_i) {
        code = String.prototype.charCodeAt.call(string, i);
        if (code > 255) {
            isUCS2 = true;
            chars = null;
            break;
        } else {
            chars.push(code);
        }
    }
    if (isUCS2 === true) {
        return unescape(encodeURIComponent(string));
    } else {
        return String.fromCharCode.apply(null, Array.prototype.slice.apply(chars));
    }
}


function StringToUint8Array(string) {
    var binary, binLen, buffer, chars, i, _i;
    binary = StringToBinary(string);
    binLen = binary.length;
    buffer = new ArrayBuffer(binLen);
    chars  = new Uint8Array(buffer);
    for (i = _i = 0; 0 <= binLen ? _i < binLen : _i > binLen; i = 0 <= binLen ? ++_i : --_i) {
        chars[i] = String.prototype.charCodeAt.call(binary, i);
    }
    return chars;
}

function resetButtons() {
  document.querySelector('#connect').disabled = false;
  document.querySelector('#scan').disabled = true;
  document.querySelector('#info').disabled = true;
  document.querySelector('#save').disabled = true;
  document.querySelector('#disconnect').disabled = true;
}

function disableButtons() {
  document.querySelector('#connect').disabled = true;
  document.querySelector('#scan').disabled = true;
  document.querySelector('#info').disabled = true;
  document.querySelector('#save').disabled = true;
  document.querySelector('#disconnect').disabled = true;
}

function connectedButtons() {
  document.querySelector('#connect').disabled = true;
  document.querySelector('#scan').disabled = false;
  document.querySelector('#info').disabled = false;
  document.querySelector('#save').disabled = false;
  document.querySelector('#disconnect').disabled = false;
}

function showModalDialog() {
  $('#modalDialog').modal('show');
}

function onDisconnected(event) {
  resetButtons();
  let device = event.target;
  setStatus('Device ' + device.name + ' is disconnected');
}


var ChromeSamples = {
    log: function() {
      var line = Array.prototype.slice.call(arguments).map(function(argument) {
        return typeof argument === 'string' ? argument : JSON.stringify(argument);
      }).join(' ');

      document.querySelector('#log').textContent += line + '\n';
    },

    clearLog: function() {
      document.querySelector('#log').textContent = '';
    },

    setStatus: function(status) {
      document.querySelector("#status").className = "alert alert-primary";
      document.querySelector('#status').textContent = status;
    },

    setStatusSuccess: function(status) {
      document.querySelector("#status").className = "alert alert-success";
      document.querySelector('#status').textContent = status;
    },

    setStatusWarn: function(status) {
      document.querySelector("#status").className = "alert alert-warning";
      document.querySelector('#status').textContent = status;
    },

    setStatusError: function(status) {
      document.querySelector("#status").className = "alert alert-danger";
      document.querySelector('#status').textContent = status;
    }

  };

var log = ChromeSamples.log;
var clearLog = ChromeSamples.clearLog;
var setStatus = ChromeSamples.setStatus;
var setStatusError = ChromeSamples.setStatusError;

function onConnectButtonClick() {

  let gatt_service = null;

  disableButtons();
  
  setStatus('Discover devices')
  navigator.bluetooth.requestDevice({filters: [{services: [serviceUuid]}]})
    .then(device => {
      setStatus('Connecting to device')
      connected_device = device;
      device.addEventListener('gattserverdisconnected', onDisconnected);
      return device.gatt.connect();
    })
    .then(server => {
      return server.getPrimaryService(serviceUuid);
    })
    .then(service => {
    	console.log('Connected');
      gatt_service = service;
      return gatt_service.getCharacteristic(txCharacteristicUuid);
    })
    .then(characteristic => {
    	console.log('TX found');
      txCharacteristic = characteristic;
      return gatt_service.getCharacteristic(rxCharacteristicUuid);
    })
    .then(characteristic => {
    	console.log('RX found');
      rxCharacteristic = characteristic;
      rxCharacteristic.addEventListener('characteristicvaluechanged', handleRxNotification);
      return rxCharacteristic.startNotifications();
    })
		.then(_ => {
			connectedButtons();
			setStatus('Connected to device: ' + connected_device.name);
		})	
    .catch(error => {
      resetButtons();
      setStatusError(String(error));
    });
}

function onScanButtonClick() {
  setStatus('Read sensor');
  operationInProgress = cmdAtScan; 
  txCharacteristic.writeValue(textEncoder.encode(cmdAtScan))
    .catch(error => {
      console.log(error)
    });
}

function onInfoButtonClick() {
  operationInProgress = cmdAtInfo;
  txCharacteristic.writeValue(textEncoder.encode(cmdAtInfo))
    .catch(error => {
      console.log(error)
    });
}

function onSaveButtonClick() {
  if ('Blob' in window) {
    var fileName = prompt('Please enter file name to save', 'SensorData_' + new Date().toISOString().replace(/:/g, '-') + '.csv');
    if (fileName) {
      
      let textToWrite = calibratedMeasurements
        .map(x => x.join(','))
        .join('\n');
    
      var textFileAsBlob = new Blob([textToWrite], { type: 'text/plain' });

      if ('msSaveOrOpenBlob' in navigator) {
        navigator.msSaveOrOpenBlob(textFileAsBlob, fileName);
      } else {
        var downloadLink = document.createElement('a');
        downloadLink.download = fileName;
        downloadLink.innerHTML = 'Download File';
        if ('webkitURL' in window) {
          // Chrome allows the link to be clicked without actually adding it to the DOM.
          downloadLink.href = window.webkitURL.createObjectURL(textFileAsBlob);
        } else {
          // Firefox requires the link to be added to the DOM before it can be clicked.
          downloadLink.href = window.URL.createObjectURL(textFileAsBlob);
          downloadLink.onclick = destroyClickedElement;
          downloadLink.style.display = 'none';
          document.body.appendChild(downloadLink);
        }
        downloadLink.click();
      }
    }
  } else {
    log('ERROR: Your browser does not support the HTML5 Blob.');
  }
}  


function onDisconnectButtonClick() {
	connected_device.gatt.disconnect();
  setStatus('Disconnected');
}

function handleRxNotification(event) {
  let msg = textDecoder.decode(event.target.value)
  if (operationInProgress == cmdAtScan) {
    handle_scan_notification(msg);
  }
  else if (operationInProgress == cmdAtInfo) {  
    handle_info_notification(msg);
  }  
  else {
    console.log("Unexpected notification:" + msg);
  }
}  

function handle_scan_notification(msg) {

  if (msg.match(scan_start_regex)) {
    console.log("Start of AT+SCAN response detected");
    disableButtons();
    var match = scan_start_regex.exec(msg);
    /* Length of the base64 part */
    expected_scan_response_length = parseInt(match[1])
    /* Find begin of base64 string */
    var pos = msg.indexOf('\n');
    notification_buffer = msg.substring(pos+1);
  }
  else if (msg.match(ok_regex)) {
    operationInProgress = null;
    console.log("End of AT+SCAN response detected")
    setStatus('Scan finished');

    /* Find end of base64 string */
    var pos = msg.indexOf('\n');
    notification_buffer += msg.substring(0, pos);

    /* Validate length of base64 encoded message */
    if (notification_buffer.length == expected_scan_response_length) {

      /* Decode base64 message */
      let resp_decoded = atob(notification_buffer);

      /* Split CBOR encoded message and SHA256 checksum */
      let resp_cbor = resp_decoded.substring(0, resp_decoded.length - SHA256_LENGTH)
      let resp_sha256 = resp_decoded.substring(resp_decoded.length - SHA256_LENGTH)

      /* Validate message checksum */
      let actual_sha256 = forge_sha256(resp_cbor)
      let expected_sha256 = ascii_to_hexa(resp_sha256)
      if (actual_sha256 == expected_sha256) {

        /* Decode CBOR */
        let cbor_success = true;
        let measurements;
        try { 
          measurements = CBOR.decode(StringToArrayBuffer(resp_cbor));
        }
        catch (e) {
          cbor_success = false;
        }

        if (cbor_success) {

          let sensor_id = measurements['sensor_id']
          console.log('Sensor ID: ' + sensor_id);
          console.log('Number of measurements: ' + measurements['measurements'].length);

          /* Call backend to calibrate sensor measurement */
          setStatus('Calibrate measurements');
          let xhr = new XMLHttpRequest();
          xhr.open("POST", '/calibrate')
          xhr.setRequestHeader('Content-type', 'application/octet-stream');
          xhr.send(notification_buffer);
          xhr.onload = function() {
            if (xhr.status == 200) { 
              let spectrum = JSON.parse(this.responseText)
              calibratedMeasurements.push(spectrum);
              if (calibratedMeasurements.length > 10) {
                calibratedMeasurements.pop();
              }
              update_spectra_plot()
              setStatus('Done');
            }
            else {
              console.log('Error calibrating sensor measurements. HTTP status: ' + xhr.status);
              setStatusError('Error calibrating sensor measurement');
            }
          };
        }
        else {
          console.log('Error decoding CBOR');
          setStatusError('Error processing sensor measurement');
        }
      }
      else {
        console.log("Invalid SHA256. Expected: " + expected_sha256 + ' Actual: ' + actual_sha256);
        setStatusError('Error processing sensor measurement');
      }
    }  
    else {
      console.log("Invalid message length. Expected: " + expected_scan_response_length + ' Actual: ' + notification_buffer.length);
      setStatusError('Error processing sensor measurement');
    }
    connectedButtons();
  }
  else if (msg.match(error_regex)) {
    operationInProgress = null;
    let error_code = error_regex.exec(msg)[1]
    console.log('Scan failed. Error: ' + error_code);
    setStatusError('Scan failed. Error: ' + error_code);
    connectedButtons();
    
  }
  else {
    notification_buffer += msg;
  }
}  

function handle_info_notification(msg) {

  if (msg.match(info_start_regex)) {  
    console.log("Start of AT+INFO response detected");
    var match = info_start_regex.exec(msg);
    notification_buffer = match[1]
  }
  else if (msg.match(ok_regex)) {  
    console.log("End of AT+INFO response detected");
    var pos = msg.indexOf('\n');
    if (pos != -1) {
      notification_buffer += msg.substring(0, pos);
    }  
    setStatus(notification_buffer)
    operationInProgress = null;
  }
  else if (msg.match(error_regex)) {  
    let error_code = error_regex.exec(msg)[1]
    console.log('Info failed. Error: ' + error_code);
    setStatusError('Info failed. Error: ' + error_code);
    operationInProgress = null;
  }
  else {
    notification_buffer += msg;
  }
}

function update_spectra_plot() {
  traces = []
  for (index = 0; index < calibratedMeasurements.length; index++) {
      let trace = {
          x: wavelengths,
          y: calibratedMeasurements[index],
          mode: 'lines',
          type: 'scatter'
      };
      traces.push(trace)
  }
  Plotly.react('spectrumDiv', traces, spectraPlotLayout, {scrollZoom: false, staticPlot: true});
}

function clear_spectra_plot() {
  let graphDiv = document.querySelector('#spectrumDiv');
  if (graphDiv && graphDiv.data) {
    while (graphDiv.data.length > 0) {
      Plotly.deleteTraces(graphDiv, [0]);
    }
  }  
}
