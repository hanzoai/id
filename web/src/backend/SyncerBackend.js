import * as Setting from "../Setting";

export function getSyncers(owner, organization, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-syncers?owner=${owner}&organization=${organization}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getSyncer(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-syncer?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateSyncer(owner, name, syncer) {
  const newSyncer = Setting.deepCopy(syncer);
  return fetch(`${Setting.ServerUrl}/api/update-syncer?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newSyncer),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addSyncer(syncer) {
  const newSyncer = Setting.deepCopy(syncer);
  return fetch(`${Setting.ServerUrl}/api/add-syncer`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newSyncer),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function testSyncerDb(syncer) {
  const newSyncer = Setting.deepCopy(syncer);
  return fetch(`${Setting.ServerUrl}/api/test-syncer-db`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newSyncer),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteSyncer(syncer) {
  const newSyncer = Setting.deepCopy(syncer);
  return fetch(`${Setting.ServerUrl}/api/delete-syncer`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newSyncer),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function runSyncer(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/run-syncer?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
