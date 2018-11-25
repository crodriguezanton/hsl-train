/* eslint-disable no-console */
// eslint-disable-next-line import/newline-after-import
const dotenv = require('dotenv');
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}
const request = require('request');
const socket = require('socket.io-client')(process.env.SOCKETS_SERVER, { reconnect: true });
const childProcess = require('child_process');
const EventEmitter = require('events');

const API_URI = process.env.API_URI || '';
let lastStation = '';
let passengersInNextStation = [];
let passengersOnBoard = [];
let lostPassengers = [];
let foundPassengers = [];
class PopInEmitter extends EventEmitter {}
const popInEmitter = new PopInEmitter();

const pingBT = passenger =>
  new Promise((resolve, reject) => {
    childProcess.exec(`l2ping -s 1 -c 1 ${passenger.mac}`, (err, stdout, stderr) => {
      console.log(stdout);
      if (err) resolve({ status: false, passenger });
      else resolve({ status: true, passenger });
    });
  });

const trackPassengers = () => {
  console.log('[TRACKING] Tracking passengers');

  console.log(`[TRACKING] Checking for ${passengersOnBoard.length} passengers:`);
  Promise.all(passengersOnBoard.map(pingBT)).then(data => {
    data.forEach(p => {
      if (p.status) {
        console.log(`Passenger (${p.passenger.name}) is still on board`);
        foundPassengers.push(p.passenger);
      } else {
        console.log(
          `We have temporarily lost Passenger (${
            p.passenger.name
          }). We will try to find him before the next stop`
        );
        lostPassengers.push(p.passenger);
      }
    });
  });
};

const checkIn = passenger => {
  console.log(`[CHECKIN] Heeey I'm checking in passenger ${passenger.name} on the train`);

  request.post(
    { url: `${API_URI}/check-in`, body: { station: lastStation, passenger }, json: true },
    (err, res, body) => {
      if (err) console.error(err);
      if (res && res.statusCode === 200) {
        console.log('checked in!');
      } else {
        // API CALL FAILED
        console.error('Some errors here... internet?');
      }
    }
  );
};

const checkOut = passenger => {
  console.log(`[CHECKOUT] I'm sad :( Passenger (${passenger.name}) just left`);

  request.post(
    { url: `${API_URI}/check-out`, body: { station: lastStation, passenger }, json: true },
    (err, res, body) => {
      console.log(body);
    }
  );
};

const arriveToStation = data => {
  console.log(`[EVENT][ARRIVE] Train arrived to a new station (${data.station}).`);
  console.log('[EVENT][ARRIVE] Fetching users at station...\n');

  // passengersInNextStation = fetch('my server');
  request.get(`${API_URI}/arrived-at/${data.station}`, (err, res, body) => {
    console.log(`These: ${body} are waiting in Station (${data.station})\n\n`);
    if (res && res.statusCode === 200) passengersInNextStation = JSON.parse(body);
  });

  console.log('[EVENT][ARRIVE] Checking out all the disconnected');
  lostPassengers.forEach(checkOut);
  lostPassengers = [];
  lastStation = data.station;
};

const leaveStation = () => {
  console.log('[EVENT][LEFT] Train left the station.');
  console.log('[EVENT][LEFT] Looking up for new passengers...\n');
  // when left the station, look up the passengers that are actually in the train
  passengersOnBoard = [...passengersOnBoard, ...foundPassengers];
  foundPassengers = [];

  const promises = [];
  passengersInNextStation.forEach(p => {
    promises.push(pingBT(p));
  });

  Promise.all(promises).then(data => {
    data.forEach(p => {
      if (p.status) {
        checkIn(p.passenger);
        passengersOnBoard.push(p.passenger);
      }
    });
    setTimeout(trackPassengers, 3 * 1000); // Timeout only for testing purposes, so that i have time to turn it off
  });
};

const trackLost = () => {
  if (lostPassengers.length > 0)
    console.log(`[LOST] Tracking lost (${lostPassengers.length} passengers)`);

  const tempFound = [];
  Promise.all(lostPassengers.map(pingBT)).then(data => {
    data.forEach(p => {
      if (p.status) {
        foundPassengers.push(p.passenger);
        tempFound.push(p.passenger);
        console.log(`Hurray! (${p.passenger.name}) is back on board.`);
      }
    });

    lostPassengers = [
      ...lostPassengers.filter(p => !tempFound.some(f => f.customerId === p.customerId))
    ];

    const time = process.env.NODE_ENV !== 'production' ? 10 : 2 * 60;
    setTimeout(trackLost, time * 1000);
  });
};
trackLost();

// EVENTS
popInEmitter.on('left station', leaveStation);
popInEmitter.on('arrived to station', arriveToStation);

socket.on('connect', () => {
  console.log('[SOCKET] Connected');
});
socket.on('departedFrom', leaveStation);
socket.on('arrivedAt', arriveToStation);
socket.on('disconnect', () => {
  console.log('[SOCKET] Disconnected');
});

// SIMULATE SOCKET EVENTS
setTimeout(() => {
  popInEmitter.emit('arrived to station', { station: '0' });
}, 1500);
setTimeout(() => {
  popInEmitter.emit('left station');
}, 7 * 1000);
