'use strict';

// [START imports]
var firebase = require('firebase-admin');
var schedule = require('node-schedule');
var Promise = require('promise');
var https = require('https');
// [END imports]

// [START definitions]
var {google} = require('googleapis');
var PROJECT_ID = 'somos-com-vc';
var HOST = 'fcm.googleapis.com';
var PATH = '/v1/projects/' + PROJECT_ID + '/messages:send';
var MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
var SCOPES = [MESSAGING_SCOPE];
var serviceAccount = require('./service-account.json');
// [END definitions]

// [START initialize]
firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount),
  databaseURL: 'https://somos-com-vc.firebaseio.com'
});
// [END initialize]

/**
 * Keep server up listenning to missions path.
 */
function startListeners() {
  firebase.database().ref('/missions').on('child_changed', function(snapshot) {
    console.log('missão alterada');
  });
  startMissionExpirySchedule();
  console.log('Mission observer started...');
}

/**
 * Construct a JSON object that will be used to define the
 * common parts of a notification message that will be sent
 * to any app instance.
 */
function buildCommonMessage(token, title, body) {
  return {
    'message': {
      'token': token,
      'notification': {
        'title': title,
        'body': body
      }
    }
  };
}

/*
 * send firebase message to user.
 */
function sendFcmMessage(fcmMessage) {
  getAccessToken().then(function(accessToken) {
    var options = {
      hostname: HOST,
      path: PATH,
      method: 'POST',
      // [START use_access_token]
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'Application/json'
      }
      // [END use_access_token]
    };

    var request = https.request(options, function(resp) {
      resp.setEncoding('utf8');
      resp.on('data', function(data) {
        console.log('Message sent to Firebase for delivery, response:');
        console.log(data);
      });
    });

    request.on('error', function(err) {
      console.log('Unable to send message to Firebase');
      console.log(err);
    });

    request.write(JSON.stringify(fcmMessage));
    request.end();
  });
}

/**
 * Send a notification to followers 3 days before mission expire.
 */
function startMissionExpirySchedule() {
  // Run this job every Day at 17:00pm.
  schedule.scheduleJob({ hour: 17 }, function () {
    firebase.database().ref('/missions').once('value', function(snapshots) {
      Object.keys(snapshots.val()).map((key) => {
        const mission = snapshots.val()[key].content;
        const missionKey = key;
        const finishDate = new Date(mission.endDate).getTime();
        const now = new Date().getTime();
        const daysToFinish = now - (3*24*60*60*1000); //three days in milliseconds
        if(mission.usersAccepted && finishDate > daysToFinish && finishDate > now) {
          const userPromises = mission.usersAccepted.map((userKey) => {
            return firebase.database().ref(`/users/${userKey.uid}/content/token`).once('value');
          });
          Promise.all(userPromises).then(results => {
            results.map(u => {
              var message = buildCommonMessage(u.val(), 'Lembrete: ' + mission.title, 'Sua missão está perto de encerrar!');
              sendFcmMessage(message);
            });
          });
        }
      });
    });
  });
  console.log('Mission expiry notifier started...');
}

/**
 * Request access token to send message. 
 */
function getAccessToken() {
  return new Promise(function(resolve, reject) {
    var key = require('./service-account.json');
    var jwtClient = new google.auth.JWT(
      key.client_email,
      null,
      key.private_key,
      SCOPES,
      null
    );
    jwtClient.authorize(function(err, tokens) {
      if (err) {
        reject(err);
        return;
      }
      resolve(tokens.access_token);
    });
  });
}
// Start the server.
startListeners();
