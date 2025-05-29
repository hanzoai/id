import React from "react";
import {createButton} from "react-social-login-buttons";

class SelfLoginButton extends React.Component {
  generateIcon() {
    const avatar = this.props.account.avatar;
    return () => {
      return <img width={36} height={36} src={avatar} alt="Sign in with Google" />;
    };
  }

  getAccountShowName() {
    let {name, displayName} = this.props.account;
    if (displayName !== "") {
      name += " (" + displayName + ")";
    }
    return name;
  }

  render() {
    const config = {
      icon: this.generateIcon(),
      iconFormat: name => `fa fa-${name}`,
      style: {background: "#ffffff", color: "#000000"},
      activeStyle: {background: "#eff0ee"},
    };

    // eslint-disable-next-line
    const SelfLoginButton = createButton(config);
    return <SelfLoginButton text={this.getAccountShowName()} onClick={this.props.onClick} align={"center"} />;
  }
}

export default SelfLoginButton;
