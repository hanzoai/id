import React from "react";
import * as Setting from "../../Setting";
import {Select} from "antd";

const {Option} = Select;

class RegionSelect extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      classes: props,
      value: "",
    };
  }

  onChange(e) {
    this.props.onChange(e);
    this.setState({value: e});
  }

  render() {
    return (
      <Select virtual={false}
        showSearch
        optionFilterProp="label"
        style={{width: "100%"}}
        defaultValue={this.props.defaultValue || undefined}
        placeholder="Please select country/region"
        onChange={(value => {this.onChange(value);})}
        filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
        filterSort={(optionA, optionB) =>
          (optionA?.label ?? "").toLowerCase().localeCompare((optionB?.label ?? "").toLowerCase())
        }
      >
        {
          Setting.getCountryCodeData().map((item) => (
            <Option key={item.code} value={item.code} label={`${item.name} (${item.code})`} >
              {Setting.getCountryImage(item)}
              {`${item.name} (${item.code})`}
            </Option>
          ))
        }
      </Select>
    );
  }
}

export default RegionSelect;
