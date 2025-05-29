import * as Setting from "../Setting";

export function getProducts(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-products?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getProduct(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-product?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateProduct(owner, name, product) {
  const newProduct = Setting.deepCopy(product);
  return fetch(`${Setting.ServerUrl}/api/update-product?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newProduct),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addProduct(product) {
  const newProduct = Setting.deepCopy(product);
  return fetch(`${Setting.ServerUrl}/api/add-product`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newProduct),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteProduct(product) {
  const newProduct = Setting.deepCopy(product);
  return fetch(`${Setting.ServerUrl}/api/delete-product`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newProduct),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function buyProduct(owner, name, providerName, pricingName = "", planName = "", userName = "", paymentEnv = "", customPrice = 0) {
  return fetch(`${Setting.ServerUrl}/api/buy-product?id=${owner}/${encodeURIComponent(name)}&providerName=${providerName}&pricingName=${pricingName}&planName=${planName}&userName=${userName}&paymentEnv=${paymentEnv}&customPrice=${customPrice}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
