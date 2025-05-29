import * as Setting from "../Setting";

export function MfaSetupInitiate(values) {
  const formData = new FormData();
  formData.append("owner", values.owner);
  formData.append("name", values.name);
  formData.append("mfaType", values.mfaType);
  return fetch(`${Setting.ServerUrl}/api/mfa/setup/initiate`, {
    method: "POST",
    credentials: "include",
    body: formData,
  }).then(res => res.json());
}

export function MfaSetupVerify(values) {
  const formData = new FormData();
  formData.append("owner", values.owner);
  formData.append("name", values.name);
  formData.append("mfaType", values.mfaType);
  formData.append("passcode", values.passcode);
  formData.append("secret", values.secret);
  formData.append("dest", values.dest);
  formData.append("countryCode", values.countryCode);
  return fetch(`${Setting.ServerUrl}/api/mfa/setup/verify`, {
    method: "POST",
    credentials: "include",
    body: formData,
  }).then(res => res.json());
}

export function MfaSetupEnable(values) {
  const formData = new FormData();
  formData.append("mfaType", values.mfaType);
  formData.append("owner", values.owner);
  formData.append("name", values.name);
  formData.append("secret", values.secret);
  formData.append("recoveryCodes", values.recoveryCodes);
  formData.append("dest", values.dest);
  formData.append("countryCode", values.countryCode);
  return fetch(`${Setting.ServerUrl}/api/mfa/setup/enable`, {
    method: "POST",
    credentials: "include",
    body: formData,
  }).then(res => res.json());
}

export function DeleteMfa(values) {
  const formData = new FormData();
  formData.append("owner", values.owner);
  formData.append("name", values.name);
  return fetch(`${Setting.ServerUrl}/api/delete-mfa`, {
    method: "POST",
    credentials: "include",
    body: formData,
  }).then(res => res.json());
}

export function SetPreferredMfa(values) {
  const formData = new FormData();
  formData.append("mfaType", values.mfaType);
  formData.append("owner", values.owner);
  formData.append("name", values.name);
  return fetch(`${Setting.ServerUrl}/api/set-preferred-mfa`, {
    method: "POST",
    credentials: "include",
    body: formData,
  }).then((res) => res.json());
}
