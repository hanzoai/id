import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/okta.svg`} alt="Sign in with Okta" style={{width: 24, height: 24}} />;
}

const config = {
  text: "Sign in with Okta",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "#ffffff", color: "#000000"},
  activeStyle: {background: "#ededee"},
};

const OktaLoginButton = createButton(config);

export default OktaLoginButton;
