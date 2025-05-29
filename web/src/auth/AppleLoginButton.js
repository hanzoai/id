import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/apple.svg`} alt="Sign in with Apple" style={{width: 24, height: 24}} />;
}

const config = {
  text: "Sign in with Apple",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "#ffffff", color: "#000000"},
  activeStyle: {background: "#ededee"},
};

const AppleLoginButton = createButton(config);

export default AppleLoginButton;
