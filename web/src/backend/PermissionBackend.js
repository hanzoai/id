import * as Setting from "../Setting";

export function getPermissions(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-permissions?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getPermissionsBySubmitter() {
  return fetch(`${Setting.ServerUrl}/api/get-permissions-by-submitter`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getPermission(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-permission?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updatePermission(owner, name, permission) {
  const newPermission = Setting.deepCopy(permission);
  return fetch(`${Setting.ServerUrl}/api/update-permission?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPermission),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addPermission(permission) {
  const newPermission = Setting.deepCopy(permission);
  return fetch(`${Setting.ServerUrl}/api/add-permission`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPermission),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deletePermission(permission) {
  const newPermission = Setting.deepCopy(permission);
  return fetch(`${Setting.ServerUrl}/api/delete-permission`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPermission),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
