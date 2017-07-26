#!/usr/bin/env node
const fetch = require('node-fetch');
const fs = require('fs-extra')

const HOST = 'https://api-dash.fabric.io';
const HEADER = {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer 2210a15a8f8fe1b6b76449dda09b0f92e0bba6bf30d726e98b14290fc83e5589'
};
const MS_PER_DAY = 1000 * 60 * 60 * 24;

Date.prototype.getUnixTime = function() {
  return this.getTime() / 1000 | 0
};

Date.prototype.increaseBy = function(i) {
  const cloneDate = new Date(this);
  cloneDate.setDate(this.getDate() + i);
  return new Date(cloneDate);
};

// a and b are javascript Date objects
function dateDiffInDays(a, b) {
  // Discard the time and time-zone information.
  const utc1 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utc2 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((utc2 - utc1) / MS_PER_DAY);
}

function increaseDateByOne(date) {
  const cloneDate = new Date(date);
  cloneDate.setDate(date.getDate() + 1);
  return new Date(cloneDate);
}

function getAppScalars(date) {
  const body = {
    query: 'query AppScalars($externalId_0:String!,$type_1:IssueType!,$start_2:UnixTimestamp!,$end_3:UnixTimestamp!,$filters_4:IssueFiltersType!) {project(externalId:$externalId_0) {crashlytics {_scalars2g2FGL:scalars(synthesizedBuildVersions:[],type:$type_1,start:$start_2,end:$end_3,filters:$filters_4) {crashes,issues,impactedDevices}},id}}',
    variables: {
      externalId_0: '54c7cd5765d38069d000000e',
      type_1: 'crash',
      start_2: startTime(date),
      end_3: endTime(date),
      filters_4: {}
    }
  };

  return fetch(
    `${HOST}/graphql?relayDebugName=AppScalars`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: HEADER,
    })
    .then(res => res.json())
    .then((json) => {
      return json.data.project.crashlytics;
    })
    .then((crashlytics) => {
      return Object.keys(crashlytics)
        .filter(key => key.includes('scalars'))
        .map(key => crashlytics[ key ])[ 0 ];
    })
    .then(scalars => {
      return scalars;
    });
}

function getSessionAndUserMetrics(date) {
  const body = {
    query: 'query SessionAndUserMetrics($externalId_0:String!,$start_1:UnixTimestamp!,$end_2:UnixTimestamp!) {project(externalId:$externalId_0) {answers {_totalSessionsForBuilds2aVUKC:totalSessionsForBuilds(synthesizedBuildVersions:["all"],start:$start_1,end:$end_2) {synthesizedBuildVersion,values {timestamp,value}},_dauByBuilds5Cgqs:dauByBuilds(builds:["all"],start:$start_1,end:$end_2) {scalar,values {timestamp,value}}},id}}',
    variables: {
      externalId_0: '54c7cd5765d38069d000000e',
      start_1: startTime(date),
      end_2: endTime(date)
    }
  };

  return fetch(
    `${HOST}/graphql?relayDebugName=SessionAndUserMetrics`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: HEADER,
    })
    .then(res => res.json())
    .then((json) => {
      return json.data.project.answers;
    })
    .then((answers) => {
      return Object.keys(answers)
        .filter(key => key.includes('totalSessions') || key.includes('ByBuild'))
        .map((key) => {
          const answer = answers[ key ];
          if (key.includes('totalSessions')) {
            return {
              sessions: {
                value: answer[ 0 ].values[ 0 ].value
              }
            }
          } else {
            return {
              users: {
                value: answer.values[ 0 ].value
              }
            }
          }

        });
    })
    .then(arr => {
      const users = arr
        .filter(o => !!o.users)
        .map(o => o.users)[ 0 ];

      const sessions = arr
        .filter(o => !!o.sessions)
        .map(o => o.sessions)[ 0 ];

      return {
        sessions: sessions.value,
        users: users.value
      };
    })
    .then(values => {
      return values;
    });
}

function startTime(date) {
  const startDate = new Date(date);
  startDate.setHours(7);
  startDate.setMinutes(0);
  startDate.setSeconds(0);
  return startDate.getUnixTime();
}

function endTime(date) {
  const endDate = date.increaseBy(1);
  endDate.setHours(6);
  endDate.setMinutes(59);
  endDate.setSeconds(0);
  return endDate.getUnixTime()
}

function fetchCrashFreeForDate(date) {
  return Promise.all([ getAppScalars(date), getSessionAndUserMetrics(date) ])
    .then(values => {
      const { crashes, impactedDevices } = values[ 0 ];
      const { sessions, users } = values[ 1 ];
      const crashFreeUsers = 100 - impactedDevices / users * 100;
      const crashFreeSessions = 100 - crashes / sessions * 100;
      return {
        crashFreeUsers,
        crashFreeSessions
      };
    });
}

const startDate = new Date('2017-4-27');
const endDate = new Date();

const dateRange = (startDate, endDate) => {
  const numDays = dateDiffInDays(startDate, endDate) + 1;
  return Array.apply(null, new Array(numDays))
    .map((_, i) => startDate.increaseBy(i))
};

const formatDate = (date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

const requests = dateRange(startDate, endDate)
  .map(date => {
    return fetchCrashFreeForDate(date)
      .then(crashFreeResult => {
        return `${formatDate(date)}, ${crashFreeResult.crashFreeUsers}, ${crashFreeResult.crashFreeSessions}`;
      });
  });

Promise.all(requests)
  .then(values => values.reduce(
    (allReport, dateReport) => allReport + '\n' + dateReport,
    'Date, Crash-free Users, Crash-free Sessions'))
  .then(csv => fs.outputFile('./report.csv', csv))
  .then(() => console.log("Successfully!"))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });