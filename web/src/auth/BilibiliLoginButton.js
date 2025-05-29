import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24, color}) {
  return <img src={`${StaticBaseUrl}/buttons/bilibili.svg`} alt="Sign in with Bilibili" />;
}

const config = {
  text: "Sign in with Bilibili",
  icon: Icon,
  iconFormat: name => `fa fa-${name}`,
  style: {background: "#0191e0"},
  activeStyle: {background: "rgb(76,143,208)"},
};

const BilibiliLoginButton = createButton(config);

export default BilibiliLoginButton;
