import * as Setting from "../Setting";

export function getResources(owner, user, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-resources?owner=${owner}&user=${user}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getResource(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-resource?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateResource(owner, name, resource) {
  const newResource = Setting.deepCopy(resource);
  return fetch(`${Setting.ServerUrl}/api/update-resource?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newResource),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addResource(resource) {
  const newResource = Setting.deepCopy(resource);
  return fetch(`${Setting.ServerUrl}/api/add-resource`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newResource),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteResource(resource, provider = "") {
  const newResource = Setting.deepCopy(resource);
  return fetch(`${Setting.ServerUrl}/api/delete-resource?provider=${provider}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newResource),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function uploadResource(owner, user, tag, parent, fullFilePath, file, provider = "") {
  const application = "app-built-in";
  const formData = new FormData();
  formData.append("file", file);
  return fetch(`${Setting.ServerUrl}/api/upload-resource?owner=${owner}&user=${user}&application=${application}&tag=${tag}&parent=${parent}&fullFilePath=${encodeURIComponent(fullFilePath)}&provider=${provider}`, {
    body: formData,
    method: "POST",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
