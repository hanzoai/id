import {Select} from "antd";
import i18next from "i18next";
import * as Setting from "../../Setting";
import React from "react";

const {Option} = Select;

export const CountryCodeSelect = (props) => {
  const {onChange, style, disabled, initValue, mode} = props;
  const countryCodes = props.countryCodes ?? [];
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    if (initValue !== undefined) {
      setValue(initValue);
    } else {
      const initValue = countryCodes.length > 0 ? countryCodes[0] : "";
      handleOnChange(initValue);
    }
  }, []);

  const handleOnChange = (value) => {
    setValue(value);
    onChange?.(value);
  };

  return (
    <Select
      virtual={false}
      showSearch
      style={style}
      disabled={disabled}
      value={value}
      mode={mode}
      dropdownMatchSelectWidth={false}
      optionLabelProp={"label"}
      onChange={handleOnChange}
      filterOption={(input, option) => (option?.text ?? "").toLowerCase().includes(input.toLowerCase())}
    >
      {
        props.hasDefault ? (<Option key={"All"} value={"All"} label={i18next.t("organization:All")} text={"organization:All"} >
          <div style={{display: "flex", justifyContent: "space-between", marginRight: "10px"}}>
            {i18next.t("organization:All")}
          </div>
        </Option>) : null
      }
      {
        Setting.getCountryCodeData(countryCodes).map((country) => Setting.getCountryCodeOption(country))
      }
    </Select>
  );
};
