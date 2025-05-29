import React from "react";
import UserEditPage from "../UserEditPage";

class AccountPage extends React.Component {
  render() {
    return (
      <UserEditPage organizationName={this.props.account.owner} userName={this.props.account.name} account={this.props.account} location={this.props.location} />
    );
  }
}

export default AccountPage;
