import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import fs from "fs";
import https from "https";
import { resolve } from "path";
import { $logger } from "../../utils/logger";
import { XMLParser } from "fast-xml-parser";
import { dumpFile } from "../../utils/dump-file";
import { omit } from "lodash";
import { jsonStringify } from "@bahatron/utils/lib/helpers";
import { $xml } from "../../utils/xml";

export async function testGetRegisteredProprietorNames() {
    // let { data } = await $hmlrTest({
    //     method: "get",
    //     url: `https://bgtest.landregistry.gov.uk/bg2test/api/v1/titles/AB1208001/registered-proprietor-names`,
    //     auth: {
    //         username: "BGUser001",
    //         password: "landreg001",
    //     },
    // });

    // await $logger.info(data);
}

export async function testDownloadTitleDeed({
    includePlan = false,
    titleNumber = "GR506405",
}) {
    let xmlRequest = `
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
            <soapenv:Header>
                <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
                    <wsse:UsernameToken>
                        <wsse:Username>BGUser001</wsse:Username>
                        <wsse:Password type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">landreg001</wsse:Password>
                    </wsse:UsernameToken>
                </wsse:Security>
                <i18n:international xmlns:i18n="http://www.w3.org/2005/09/ws-i18n">
                    <i18n:locale>en</i18n:locale>
                </i18n:international>
            </soapenv:Header>
            <soapenv:Body>
                <ns3:performOCWithSummary xmlns:ns1="http://www.oscre.org/ns/eReg-Final/2011/RequestOCWithSummaryV2_0" xmlns:ns3="http://ocwithsummaryv2_1.ws.bg.lr.gov/">
                    <arg0>
                        <ns1:ID>
                            <ns1:MessageID>170100</ns1:MessageID>
                        </ns1:ID>
                        <ns1:Product>
                            <ns1:SubjectProperty>
                                <ns1:TitleNumber>${titleNumber}</ns1:TitleNumber>
                            </ns1:SubjectProperty>
                            <ns1:ExpectedPrice>
                                <ns1:GrossPriceAmount>${
                                    includePlan ? "14.00" : "7.00"
                                }</ns1:GrossPriceAmount>
                            </ns1:ExpectedPrice>
                            <ns1:ExternalReference>
                                <ns1:Reference>Ext_ref</ns1:Reference>
                            </ns1:ExternalReference>
                            <ns1:CustomerReference>
                                <ns1:Reference>Bguser1</ns1:Reference>
                            </ns1:CustomerReference>
                            <ns1:TitleKnownOfficialCopy>
                                <ns1:ContinueIfTitleIsClosedAndContinuedIndicator>false</ns1:ContinueIfTitleIsClosedAndContinuedIndicator>
                                <ns1:NotifyIfPendingFirstRegistrationIndicator>false</ns1:NotifyIfPendingFirstRegistrationIndicator>
                                <ns1:NotifyIfPendingApplicationIndicator>false</ns1:NotifyIfPendingApplicationIndicator>
                                <ns1:SendBackDatedIndicator>false</ns1:SendBackDatedIndicator>
                                <ns1:ContinueIfActualFeeExceedsExpectedFeeIndicator>false</ns1:ContinueIfActualFeeExceedsExpectedFeeIndicator>
                               <ns1:IncludeTitlePlanIndicator>${
                                   includePlan ? "true" : "false"
                               }</ns1:IncludeTitlePlanIndicator>
                            </ns1:TitleKnownOfficialCopy>
                        </ns1:Product>
                    </arg0>
                </ns3:performOCWithSummary>
            </soapenv:Body>
        </soapenv:Envelope>
    `;

    // let res = await $hmlrTest({
    //     method: "post",
    //     url: "https://bgtest.landregistry.gov.uk/b2b/BGStubService/OfficialCopyWithSummaryV2_1WebService",
    //     headers: {
    //         "Content-Type": "application/xml",
    //     },
    //     data: xmlRequest,
    // })
    //     .then((res) => res.data)
    //     .catch((err) => $logger.warning(err));

    // let parsed = $xml.parse(res);

    // $logger.debug(parsed);

    // let metadata = omit(
    //     parsed["Envelope"]["Body"]["performOCWithSummaryResponse"]["return"][
    //         "GatewayResponse"
    //     ]["Results"],
    //     ["Attachment"]
    // );

    // await dumpFile(`result.json`, jsonStringify(metadata, null, 4));

    // let binaryString =
    //     parsed["Envelope"]["Body"]["performOCWithSummaryResponse"]["return"][
    //         "GatewayResponse"
    //     ]["Results"]["Attachment"]["EmbeddedFileBinaryObject"]["#text"];

    // // $logger.info(parsed["soap:Envelope"]["soap:Body"], "body");

    // const zipBuffer = Buffer.from(binaryString, "base64");

    // await dumpFile("test-title-deed.zip", zipBuffer);
}
