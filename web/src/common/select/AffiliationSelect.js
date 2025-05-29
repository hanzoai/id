import React from "react";
import {Cascader, Col, Input, Row, Select} from "antd";
import i18next from "i18next";
import * as UserBackend from "../../backend/UserBackend";
import * as Setting from "../../Setting";

class AffiliationSelect extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      classes: props,
      addressOptions: [],
      affiliationOptions: [],
    };
  }

  componentDidMount() {
    this.getAddressOptions(this.props.application);
    this.getAffiliationOptions(this.props.application, this.props.user);
  }

  getAddressOptions(application) {
    if (application.affiliationUrl === "") {
      return;
    }

    const addressUrl = application.affiliationUrl.split("|")[0];
    UserBackend.getAddressOptions(addressUrl)
      .then((addressOptions) => {
        this.setState({
          addressOptions: addressOptions,
        });
      });
  }

  getAffiliationOptions(application, user) {
    if (application.affiliationUrl === "") {
      return;
    }

    const affiliationUrl = application.affiliationUrl.split("|")[1];
    const code = user.address[user.address.length - 1];
    UserBackend.getAffiliationOptions(affiliationUrl, code)
      .then((affiliationOptions) => {
        this.setState({
          affiliationOptions: affiliationOptions,
        });
      });
  }

  updateUserField(key, value) {
    this.props.onUpdateUserField(key, value);
  }

  render() {
    return (
      <React.Fragment>
        {
          this.props.application?.affiliationUrl === "" ? null : (
            <Row style={{marginTop: "20px"}} >
              <Col style={{marginTop: "5px"}} span={this.props.labelSpan}>
                {Setting.getLabel(i18next.t("user:Address"), i18next.t("user:Address - Tooltip"))} :
              </Col>
              <Col span={24 - this.props.labelSpan} >
                <Cascader style={{width: "100%", maxWidth: "400px"}} value={this.props.user.address} options={this.state.addressOptions} onChange={value => {
                  this.updateUserField("address", value);
                  this.updateUserField("affiliation", "");
                  this.updateUserField("score", 0);
                  this.getAffiliationOptions(this.props.application, this.props.user);
                }} placeholder={i18next.t("signup:Please input your address!")} />
              </Col>
            </Row>
          )
        }
        <Row style={{marginTop: "20px"}} >
          <Col style={{marginTop: "5px"}} span={this.props.labelSpan}>
            {Setting.getLabel(i18next.t("user:Affiliation"), i18next.t("user:Affiliation - Tooltip"))} :
          </Col>
          <Col span={22} >
            {
              this.props.application?.affiliationUrl === "" ? (
                <Input value={this.props.user.affiliation} onChange={e => {
                  this.updateUserField("affiliation", e.target.value);
                }} />
              ) : (
                <Select virtual={false} style={{width: "100%"}} value={this.props.user.affiliation}
                  onChange={(value => {
                    const name = value;
                    const affiliationOption = Setting.getArrayItem(this.state.affiliationOptions, "name", name);
                    const id = affiliationOption.id;
                    this.updateUserField("affiliation", name);
                    this.updateUserField("score", id);
                  })}
                  options={[Setting.getOption(`(${i18next.t("general:empty")})`, "")].concat(this.state.affiliationOptions.map((affiliationOption) => Setting.getOption(affiliationOption.name, affiliationOption.name))
                  )} />
              )
            }
          </Col>
        </Row>
      </React.Fragment>
    );
  }
}

export default AffiliationSelect;
