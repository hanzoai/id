import React from "react";
import * as Setting from "../Setting";

class OdicDiscoveryPage extends React.Component {
  UNSAFE_componentWillMount() {
    if (Setting.isLocalhost()) {
      Setting.goToLink(`${Setting.ServerUrl}/.well-known/openid-configuration`);
    }
  }

  render() {
    return null;
  }
}

export default OdicDiscoveryPage;
