import React, {useEffect} from "react";
import i18next from "i18next";

export const RedirectForm = (props) => {

  useEffect(() => {
    document.getElementById("saml").submit();
  }, []);

  return (
    <React.Fragment>
      <p>{i18next.t("login:Redirecting, please wait.")}</p>
      <form id="saml" method="post" action={props.redirectUrl}>
        <input
          type="hidden"
          name="SAMLResponse"
          id="samlResponse"
          value={props.samlResponse}
        />
        <input
          type="hidden"
          name="RelayState"
          id="relayState"
          value={props.relayState}
        />
      </form>
    </React.Fragment>
  );
};

export default RedirectForm;
