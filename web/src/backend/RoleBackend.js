import * as Setting from "../Setting";

export function getRoles(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-roles?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getRole(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-role?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateRole(owner, name, role) {
  const newRole = Setting.deepCopy(role);
  return fetch(`${Setting.ServerUrl}/api/update-role?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newRole),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addRole(role) {
  const newRole = Setting.deepCopy(role);
  return fetch(`${Setting.ServerUrl}/api/add-role`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newRole),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteRole(role) {
  const newRole = Setting.deepCopy(role);
  return fetch(`${Setting.ServerUrl}/api/delete-role`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newRole),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
