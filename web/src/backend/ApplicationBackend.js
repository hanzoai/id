import * as Setting from "../Setting";

export function getApplications(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-applications?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getApplicationsByOrganization(owner, organization, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-organization-applications?owner=${owner}&organization=${organization}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getApplication(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-application?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getUserApplication(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-user-application?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateApplication(owner, name, application) {
  return fetch(`${Setting.ServerUrl}/api/update-application?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(application),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addApplication(application) {
  const newApplication = Setting.deepCopy(application);
  return fetch(`${Setting.ServerUrl}/api/add-application`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newApplication),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteApplication(application) {
  const newApplication = Setting.deepCopy(application);
  return fetch(`${Setting.ServerUrl}/api/delete-application`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newApplication),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getSamlMetadata(owner, name, enablePostBinding) {
  return fetch(`${Setting.ServerUrl}/api/saml/metadata?application=${owner}/${encodeURIComponent(name)}&enablePostBinding=${enablePostBinding}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.text());
}
