import React, {forwardRef, useEffect, useImperativeHandle, useRef, useState} from "react";

const IframeEditor = forwardRef(({initialModelText, onModelTextChange}, ref) => {
  const iframeRef = useRef(null);
  const [iframeReady, setIframeReady] = useState(false);
  const currentLang = localStorage.getItem("language") || "en";

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== "https://editor.casbin.org") {return;}

      if (event.data.type === "modelUpdate") {
        onModelTextChange(event.data.modelText);
      } else if (event.data.type === "iframeReady") {
        setIframeReady(true);
        if (initialModelText && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: "initializeModel",
            modelText: initialModelText,
            lang: currentLang,
          }, "*");
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onModelTextChange, initialModelText, currentLang]);

  useImperativeHandle(ref, () => ({
    getModelText: () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: "getModelText",
        }, "*");
      }
    },
    updateModelText: (newModelText) => {
      if (iframeReady && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: "updateModelText",
          modelText: newModelText,
        }, "*");
      }
    },
  }));

  return (
    <iframe
      ref={iframeRef}
      src={`https://editor.casbin.org/model-editor?lang=${currentLang}`}
      frameBorder="0"
      width="100%"
      height="500px"
      title="Casbin Model Editor"
    />
  );
});

export default IframeEditor;
