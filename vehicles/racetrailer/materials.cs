
singleton Material(racetrailer_Red_Rubber)
{
    mapTo = "racetrailer_Red_Rubber";
    specularPower[0] = "0";
    pixelSpecular[0] = "0";
    diffuseColor[0] = "0.75 0.08 0.08 1";
    specularPower[1] = "1";
    pixelSpecular[1] = "1";
    diffuseColor[1] = "0 0 0 0.12";

    SpecularColor[1] = "0.1 0.1 0.1 0.1";

    useAnisotropic[0] = "1";
    useAnisotropic[1] = "1";
    castShadows = "1";
    translucent = "1";
    translucentBlendOp = "None";
    alphaTest = "0";
    alphaRef = "0";
    doubleSided = "1";
    materialTag0 = "beamng"; materialTag1 = "vehicle";
};

singleton Material(racetrailer_matblack)
{
    mapTo = "racetrailer_matblack";
    diffuseColor[0] = "0.2 0.2 0.2 1";
    specular[0] = "1 1 1 1";
    specularPower[0] = "128";
    doubleSided = "1";
    translucentBlendOp = "None";
    diffuseColor[1] = "1 1 1 1";
    specularPower[1] = "128";
    specularStrength[1] = "2";
};

singleton Material(racetrailer_turbo_Gray)
{
    mapTo = "racetrailer_Gray";
    specularPower[0] = "128";
    pixelSpecular[0] = "1";
    diffuseColor[0] = "0.85 0.85 0.85 1";
    useAnisotropic[0] = "1";
    doubleSided = "1";
    castShadows = "0.5";
    translucent = "0.5";
    translucentBlendOp = "None";
    alphaTest = "0";
    alphaRef = "0";
    dynamicCubemap ="false";
    materialTag0 = "beamng"; materialTag1 = "vehicle";
    cubemap = "global_cubemap_metalblurred";
};

singleton Material(racetrailer_chrome)
{
    mapTo = "racetrailer_chrome";
    castShadows = "1";
    translucent = "0";
    doubleSided = "1";

    colorMap[1] = "vehicles/common/null.dds";
    colorMap[2] = "vehicles/common/null.dds";
    diffuseMap[0] = "vehicles/common/null.dds";	
    diffuseMap[1] = "vehicles/common/null.dds";	
    diffuseMap[2] = "vehicles/common/null.dds";	

    translucentZWrite = "1";
    specularPower[0] = "128";
    pixelSpecular[0] = "1";
    specularPower[1] = "128";
    pixelSpecular[1] = "1";
    specularPower[2] = "128";
    pixelSpecular[2] = "1";

    diffuseColor[0] = "1 1 1 1";
    diffuseColor[1] = "0.01 0.01 0.01 0.05";
    diffuseColor[2] = "0.7 0.7 0.7 0.05";

    useAnisotropic[0] = "1";
    useAnisotropic[1] = "1";
    useAnisotropic[2] = "1";

    translucentBlendOp = "None";
    alphaTest = "0";
    alphaRef = "0";

    dynamicCubemap = true;
	doubleSided = true;

    materialTag0 = "beamng"; materialTag1 = "vehicle";
};

singleton Material(racetrailer_painted2)
{
    mapTo = "racetrailer_painted2";
    castShadows = "1";
    translucent = "0";
    doubleSided = "1";

    colorPaletteMap[1] = "Color2.jpg";
    colorPaletteMap[2] = "Color2.jpg";
    diffuseMap[0] = "vehicles/common/null.dds";	
    diffuseMap[1] = "vehicles/common/null.dds";	
    diffuseMap[2] = "vehicles/common/null.dds";	

    translucentZWrite = "1";
    specularPower[0] = "128";
    pixelSpecular[0] = "1";
    specularPower[1] = "32";
    pixelSpecular[1] = "1";
    specularPower[2] = "128";
    pixelSpecular[2] = "1";


    diffuseColor[0] = "1 1 1 1";
    diffuseColor[1] = "1 1 1 0.337"; //0.337
    diffuseColor[2] = "1 1 1 0.42";

    useAnisotropic[0] = "1";
    useAnisotropic[1] = "1";
    useAnisotropic[2] = "1";
    //useAnisotropic[3] = "1";

    translucentBlendOp = "None";
    alphaTest = "0";
    alphaRef = "0";

    dynamicCubemap = true;
	doubleSided = true;

    //instanceDiffuse[0] = true;
    instanceDiffuse[1] = true;
    instanceDiffuse[2] = true;


    materialTag0 = "beamng"; materialTag1 = "vehicle";
};
singleton Material(racetrailer_painted3)
{
    mapTo = "racetrailer_painted3";
    castShadows = "1";
    translucent = "0";
    doubleSided = "1";

    colorPaletteMap[1] = "Color3.jpg";
    colorPaletteMap[2] = "Color3.jpg";
    diffuseMap[0] = "vehicles/common/null.dds";	
    diffuseMap[1] = "vehicles/common/null.dds";	
    diffuseMap[2] = "vehicles/common/null.dds";	

    translucentZWrite = "1";
    specularPower[0] = "128";
    pixelSpecular[0] = "1";
    specularPower[1] = "32";
    pixelSpecular[1] = "1";
    specularPower[2] = "128";
    pixelSpecular[2] = "1";


    diffuseColor[0] = "1 1 1 1";
    diffuseColor[1] = "1 1 1 0.337"; //0.337
    diffuseColor[2] = "1 1 1 0.42";

    useAnisotropic[0] = "1";
    useAnisotropic[1] = "1";
    useAnisotropic[2] = "1";
    //useAnisotropic[3] = "1";

    translucentBlendOp = "None";
    alphaTest = "0";
    alphaRef = "0";

    dynamicCubemap = true;
	doubleSided = true;

    //instanceDiffuse[0] = true;
    instanceDiffuse[1] = true;
    instanceDiffuse[2] = true;


    materialTag0 = "beamng"; materialTag1 = "vehicle";
};