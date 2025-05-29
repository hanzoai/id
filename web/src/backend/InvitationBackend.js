import * as Setting from "../Setting";

export function getInvitations(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-invitations?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getInvitation(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-invitation?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getInvitationCodeInfo(code, applicationName) {
  return fetch(`${Setting.ServerUrl}/api/get-invitation-info?code=${code}&applicationId=${encodeURIComponent(applicationName)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateInvitation(owner, name, invitation) {
  const newInvitation = Setting.deepCopy(invitation);
  return fetch(`${Setting.ServerUrl}/api/update-invitation?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newInvitation),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addInvitation(invitation) {
  const newInvitation = Setting.deepCopy(invitation);
  return fetch(`${Setting.ServerUrl}/api/add-invitation`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newInvitation),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteInvitation(invitation) {
  const newInvitation = Setting.deepCopy(invitation);
  return fetch(`${Setting.ServerUrl}/api/delete-invitation`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newInvitation),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function verifyInvitation(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/verify-invitation?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
