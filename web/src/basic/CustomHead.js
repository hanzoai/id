import {useEffect} from "react";

let customHeadLoaded = false;

function CustomHead(props) {
  useEffect(() => {
    if (!customHeadLoaded) {
      const suffix = new Date().getTime().toString();

      if (!props.headerHtml) {return;}
      const node = document.createElement("div");
      node.innerHTML = props.headerHtml;

      node.childNodes.forEach(el => {
        if (el.nodeName === "#text") {
          return;
        }
        let innerNode = el;
        innerNode.setAttribute("app-custom-head" + suffix, "");

        if (innerNode.localName === "script") {
          const scriptNode = document.createElement("script");
          Array.from(innerNode.attributes).forEach(attr => {
            scriptNode.setAttribute(attr.name, attr.value);
          });
          scriptNode.text = innerNode.textContent;
          innerNode = scriptNode;
        }
        document.head.appendChild(innerNode);
      });
      customHeadLoaded = true;
    }
  });
}

export default CustomHead;
