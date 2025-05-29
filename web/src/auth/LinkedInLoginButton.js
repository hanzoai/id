import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/linkedin.svg`} alt="Sign in with LinkedIn" />;
}

const config = {
  text: "Sign in with LinkedIn",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "rgb(255,255,255)", color: "#000000"},
  activeStyle: {background: "rgb(240,240,250)"},
};

const LinkedInLoginButton = createButton(config);

export default LinkedInLoginButton;
