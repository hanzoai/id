import * as Setting from "../Setting";

export function getGroups(owner = "", withTree = false, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-groups?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}&withTree=${withTree}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getGroup(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-group?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateGroup(owner, name, group) {
  const newGroup = Setting.deepCopy(group);
  return fetch(`${Setting.ServerUrl}/api/update-group?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newGroup),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addGroup(group) {
  const newGroup = Setting.deepCopy(group);
  return fetch(`${Setting.ServerUrl}/api/add-group`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newGroup),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteGroup(group) {
  const newGroup = Setting.deepCopy(group);
  return fetch(`${Setting.ServerUrl}/api/delete-group`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newGroup),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
