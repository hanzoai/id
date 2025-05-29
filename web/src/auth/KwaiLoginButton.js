import {createButton} from "react-social-login-buttons";
import {StaticBaseUrl} from "../Setting";

function Icon({width = 24, height = 24}) {
  return <img src={`${StaticBaseUrl}/buttons/kwai.svg`} alt="Sign in with Kwai" style={{width: width, height: height}} />;
}

const config = {
  text: "Sign in with Kwai",
  icon: Icon,
  style: {background: "#ffffff", color: "#000000"},
  activeStyle: {background: "#ededee"},
};

const KwaiLoginButton = createButton(config);

export default KwaiLoginButton;
