// config.js
// 用户可在页面 Settings 里修改，无需改代码。
window.P1P3_CONFIG = {
  dataBase: localStorage.getItem("p1p3_dataBase") || "/data",
  onlineDict: (localStorage.getItem("p1p3_onlineDict") || "1") === "1",
};
