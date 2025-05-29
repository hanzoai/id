import i18next from "i18next";
import {createButton} from "react-social-login-buttons";

function LoginButton({type, logoUrl, align = "center", style = {background: "#ffffff", color: "#000000"}, activeStyle = {background: "#ededee"}}) {
  function Icon({width = 24, height = 24, color}) {
    return <img src={logoUrl} alt={`Sign in with ${type}`} style={{width: width, height: height}} />;
  }
  const config = {
    text: `Sign in with ${type}`,
    icon: Icon,
    style: style,
    activeStyle: activeStyle,
  };
  // eslint-disable-next-line
  const Button = createButton(config);
  const text = i18next.t("login:Sign in with {type}").replace("{type}", type);
  return <Button text={text} align={align} />;
}

export default LoginButton;
