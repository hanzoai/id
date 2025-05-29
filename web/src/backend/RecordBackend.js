import * as Setting from "../Setting";

export function getRecords(organizationName, page, pageSize, field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-records?organizationName=${organizationName}&pageSize=${pageSize}&p=${page}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
