Module["print"] = function(data) {
  if (Module["listener"]) {
    Module["listener"](String(data));
  } else {
    console.log(data);
  }
};

Module["printErr"] = function(data) {
  if (Module["listener"]) {
    Module["listener"](String(data));
  } else {
    console.error(data);
  }
};

