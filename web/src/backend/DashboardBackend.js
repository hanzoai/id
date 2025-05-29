import * as Setting from "../Setting";

export function getDashboard(owner) {
  return fetch(`${Setting.ServerUrl}/api/get-dashboard?owner=${owner}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
