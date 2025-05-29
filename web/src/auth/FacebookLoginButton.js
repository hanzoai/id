import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/facebook.svg`} alt="Sign in with Facebook" />;
}

const config = {
  text: "Sign in with Facebook",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "#3b5998"},
  activeStyle: {background: "#2b3f65"},
};

const FacebookLoginButton = createButton(config);

export default FacebookLoginButton;
