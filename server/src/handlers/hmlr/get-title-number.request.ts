import { ulid } from "ulidx";
import { $hmlr } from "./hmlr.service";
import { $xml } from "../../utils/xml";
import { $logger } from "../../utils/logger";
import { IdpAddress } from "../../models/db/idp-addresses";
import { ExpectationFailed } from "@bahatron/utils/lib/error";

export interface TitleNumber {
    TitleNumber: string;
    TenureInformation: {
        TenureTypeCode: number;
    };
    Address: {
        BuildingName: string;
        SubBuildingName: number;
        BuildingNumber: number;
        StreetName: string;
        CityName: string;
        PostcodeZone: {
            Postcode: string;
        };
    };
}

export async function getTitleNumber(
    address: IdpAddress
): Promise<TitleNumber[]> {
    let premise = address.data.premise.split(" ")[0];

    let buildingNumber =
        address.data.building_number.length &&
        address.data.building_number.length < 5
            ? address.data.building_number
            : address.data.building_name.length &&
              address.data.building_name.length < 5
            ? address.data.building_name
            : premise.length && premise.length < 5
            ? premise
            : "";

    let postcode = address.data.postcode;
    let buildingName = address.data.building_name;

    $logger.debug(
        {
            buildingNumber,
            postcode,
            buildingName,
            uprn: address.uprn,
            address: address.data,
        },
        "getting title number for address"
    );

    let { data } = await $hmlr({
        method: "post",
        url: "https://businessgateway.landregistry.gov.uk/b2b/BGSoapEngine/EnquiryByPropertyDescriptionV2_0WebService?wsdl",
        headers: {
            "Content-Type": "application/xml",
        },
        data: buildTitleNumberRequest({
            userName: process.env.HMLR_USERNAME!,
            password: process.env.HMLR_PASSWORD!,
            buildingNumber,
            buildingName,
            postcode,
        }),
    });

    let response = $xml.parse(data);

    if (response["Envelope"]["Body"]["Fault"]) {
        throw ExpectationFailed(
            {
                error: response["Envelope"]["Body"]["Fault"],
                uprn: address.uprn,
            },
            "HMLR_TITLE_NUMBER_REQUEST_FAILED"
        );
    }

    $logger.debug(response, "got title number response");

    let result =
        response["Envelope"]["Body"]["searchPropertiesResponse"]["return"][
            "GatewayResponse"
        ];

    if (result["TypeCode"] !== 30) {
        $logger.warn(
            result,
            "HMLR title number request unexpected response type code"
        );

        throw ExpectationFailed(
            result,
            "HMLR_TITLE_NUMBER_REQUEST_INVALID_RESPONSE_TYPE_CODE"
        );
    }

    let titles = result["Results"]["Title"] as TitleNumber | TitleNumber[];

    if (!Array.isArray(titles)) {
        return [titles];
    }

    return titles;
}

function buildTitleNumberRequest({
    userName,
    password,
    buildingNumber = "",
    buildingName = "",
    postcode,
}) {
    let addresses = [
        buildingNumber &&
            `<ns2:BuildingNumber>${buildingNumber}</ns2:BuildingNumber>`,
        buildingName && `<ns2:BuildingName>${buildingName}</ns2:BuildingName>`,
    ];

    let address = addresses.filter(Boolean).shift();

    $logger.debug(address, "addresses");

    return `
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
            <soapenv:Header>
                <wsse:Security
                    xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
                    <wsse:UsernameToken>
                        <wsse:Username>${userName}</wsse:Username>
                        <wsse:Password type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${password}</wsse:Password>
                    </wsse:UsernameToken>
                </wsse:Security>
                <i18n:international xmlns:i18n="http://www.w3.org/2005/09/ws-i18n">
                    <i18n:locale>en</i18n:locale>
                </i18n:international>
            </soapenv:Header>

            <soapenv:Body>
                <ns3:searchProperties
                    xmlns:ns2="http://www.oscre.org/ns/eReg-Final/2011/RequestSearchByPropertyDescriptionV2_0"
                    xmlns:ns3="http://epdv2_0.ws.bg.lr.gov/">
                    <arg0>
                        <ns2:ID>
                            <ns2:MessageID>${ulid()}</ns2:MessageID>
                        </ns2:ID>
                        <ns2:Product>
                            <ns2:ExternalReference>
                                <ns2:Reference>extRef0001</ns2:Reference>
                            </ns2:ExternalReference>
                            <ns2:CustomerReference>
                                <ns2:Reference>custRef0001</ns2:Reference>
                            </ns2:CustomerReference>
                            <ns2:SubjectProperty>
                                <ns2:Address>
                                    ${address}
                                    <ns2:PostcodeZone>${postcode}</ns2:PostcodeZone>
                                </ns2:Address>
                            </ns2:SubjectProperty>
                        </ns2:Product>
                    </arg0>
                </ns3:searchProperties>
            </soapenv:Body>
        </soapenv:Envelope>
    `;
}
