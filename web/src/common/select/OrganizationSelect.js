import React from "react";
import {Select} from "antd";
import i18next from "i18next";
import * as OrganizationBackend from "../../backend/OrganizationBackend";
import * as Setting from "../../Setting";

function OrganizationSelect(props) {
  const {onChange, initValue, style, onSelect, withAll, className} = props;
  const [organizations, setOrganizations] = React.useState([]);
  const [value, setValue] = React.useState(initValue);

  React.useEffect(() => {
    if (props.organizations === undefined) {
      getOrganizations();
    }
    window.addEventListener("storageOrganizationsChanged", getOrganizations);
    return function() {
      window.removeEventListener("storageOrganizationsChanged", getOrganizations);
    };
  }, [value]);

  const getOrganizations = () => {
    OrganizationBackend.getOrganizationNames("admin")
      .then((res) => {
        if (res.status === "ok") {
          setOrganizations(res.data);
          const selectedValueExist = res.data.filter(organization => organization.name === value).length > 0;
          if (initValue === undefined || !selectedValueExist) {
            handleOnChange(getOrganizationItems().length > 0 ? getOrganizationItems()[0].value : "");
          }
        }
      });
  };

  const handleOnChange = (value) => {
    setValue(value);
    onChange?.(value);
  };

  const getOrganizationItems = () => {
    const items = [];

    organizations.forEach((organization) => items.push(Setting.getOption(organization.displayName, organization.name)));

    if (withAll) {
      items.unshift({
        label: i18next.t("organization:All"),
        value: "All",
      });
    }

    return items;
  };

  return (
    <Select
      options={getOrganizationItems()}
      virtual={false}
      popupMatchSelectWidth={false}
      placeholder={i18next.t("login:Please select an organization")}
      value={value}
      onChange={handleOnChange}
      filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
      style={style}
      onSelect={onSelect}
      className={className}
    >
    </Select>
  );
}

export default OrganizationSelect;
