import {authConfig} from "./Auth";
import * as Setting from "../Setting";

export function getAccount(query = "") {
  return fetch(`${authConfig.serverUrl}/api/get-account${query}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function signup(values) {
  return fetch(`${authConfig.serverUrl}/api/signup`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(values),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getEmailAndPhone(organization, username) {
  return fetch(`${authConfig.serverUrl}/api/get-email-and-phone?organization=${organization}&username=${username}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then((res) => res.json());
}

export function casLoginParamsToQuery(casParams) {
  return `?type=${casParams?.type}&id=${casParams?.id}&redirectUri=${casParams?.service}`;
}

export function oAuthParamsToQuery(oAuthParams) {
  // login
  if (oAuthParams === null || oAuthParams === undefined) {
    return "";
  }

  // code
  return `?clientId=${oAuthParams.clientId}&responseType=${oAuthParams.responseType}&redirectUri=${encodeURIComponent(oAuthParams.redirectUri)}&type=${oAuthParams.type}&scope=${oAuthParams.scope}&state=${oAuthParams.state}&nonce=${oAuthParams.nonce}&code_challenge_method=${oAuthParams.challengeMethod}&code_challenge=${oAuthParams.codeChallenge}`;
}

export function getApplicationLogin(params) {
  const queryParams = (params?.type === "cas") ? casLoginParamsToQuery(params) : oAuthParamsToQuery(params);
  return fetch(`${authConfig.serverUrl}/api/get-app-login${queryParams}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function login(values, oAuthParams) {
  return fetch(`${authConfig.serverUrl}/api/login${oAuthParamsToQuery(oAuthParams)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(values),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function loginCas(values, params) {
  return fetch(`${authConfig.serverUrl}/api/login?service=${params.service}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(values),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function logout() {
  return fetch(`${authConfig.serverUrl}/api/logout`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function unlink(values) {
  return fetch(`${authConfig.serverUrl}/api/unlink`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(values),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getSamlLogin(providerId, relayState) {
  return fetch(`${authConfig.serverUrl}/api/get-saml-login?id=${providerId}&relayState=${relayState}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function loginWithSaml(values, param) {
  return fetch(`${authConfig.serverUrl}/api/login${param}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(values),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getWechatMessageEvent(ticket) {
  return fetch(`${Setting.ServerUrl}/api/get-webhook-event?ticket=${ticket}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getWechatQRCode(providerId) {
  return fetch(`${Setting.ServerUrl}/api/get-qrcode?id=${providerId}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getCaptchaStatus(values) {
  return fetch(`${Setting.ServerUrl}/api/get-captcha-status?organization=${values["organization"]}&userId=${values["username"]}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
