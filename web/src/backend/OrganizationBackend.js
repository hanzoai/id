import * as Setting from "../Setting";

export function getOrganizations(owner, organizationName = "", page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-organizations?owner=${owner}&organizationName=${organizationName}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getOrganization(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-organization?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateOrganization(owner, name, organization) {
  const newOrganization = Setting.deepCopy(organization);
  return fetch(`${Setting.ServerUrl}/api/update-organization?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newOrganization),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addOrganization(organization) {
  const newOrganization = Setting.deepCopy(organization);
  return fetch(`${Setting.ServerUrl}/api/add-organization`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newOrganization),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteOrganization(organization) {
  const newOrganization = Setting.deepCopy(organization);
  return fetch(`${Setting.ServerUrl}/api/delete-organization`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newOrganization),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getDefaultApplication(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-default-application?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getOrganizationNames(owner) {
  return fetch(`${Setting.ServerUrl}/api/get-organization-names?owner=${owner}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
