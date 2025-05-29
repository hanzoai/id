import * as Setting from "../Setting";

export function getSystemInfo() {
  return fetch(`${Setting.ServerUrl}/api/get-system-info`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getVersionInfo() {
  return fetch(`${Setting.ServerUrl}/api/get-version-info`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getPrometheusInfo() {
  return fetch(`${Setting.ServerUrl}/api/get-prometheus-info `, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
