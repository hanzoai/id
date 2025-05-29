import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import {materialDark} from "@uiw/codemirror-theme-material";
import {langs} from "@uiw/codemirror-extensions-langs";

export const Editor = (props) => {
  let style = {};
  let height = props.height;
  let width = props.width;
  const copy2StyleProps = [
    "width", "maxWidth", "minWidth",
    "height", "maxHeight", "minHeight",
  ];
  if (props.fillHeight) {
    height = "100%";
    style = {...style, height: "100%"};
  }
  if (props.fillWidth) {
    width = "100%";
    style = {...style, width: "100%"};
  }
  /**
   * @uiw/react-codemirror style props sucha as "height" "width"
   * may need to be configured with "style" in some scenarios to take effect
   */
  copy2StyleProps.forEach(el => {
    if (["number", "string"].includes(typeof props[el])) {
      style = {...style, [el]: props[el]};
    }
  });
  if (props.style) {
    style = {...style, ...props.style};
  }
  let extensions = [];
  switch (props.lang) {
  case "javascript":
  case "js":
    extensions = [langs.javascript()];
    break;
  case "html":
    extensions = [langs.html()];
    break;
  case "css":
    extensions = [langs.css()];
    break;
  case "xml":
    extensions = [langs.xml()];
    break;
  case "json":
    extensions = [langs.json()];
    break;
  }

  return (
    <CodeMirror
      value={props.value}
      {...props}
      width={width}
      height={height}
      style={style}
      readOnly={props.readOnly}
      theme={props.dark ? materialDark : "light"}
      extensions={extensions}
      onChange={props.onChange}
    />
  );
};

export default Editor;
