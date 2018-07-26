/*
SQLyog Community v12.4.3 (64 bit)
MySQL - 5.5.21-log : Database - billingv2
*********************************************************************
*/

/*!40101 SET NAMES utf8 */;

/*!40101 SET SQL_MODE=''*/;

/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
CREATE DATABASE /*!32312 IF NOT EXISTS*/`billingv2` /*!40100 DEFAULT CHARACTER SET utf8 */;

USE `billingv2`;

/* Procedure structure for procedure `SP_CreateDummyPaymentInfo` */

/*!50003 DROP PROCEDURE IF EXISTS  `SP_CreateDummyPaymentInfo` */;

DELIMITER $$

/*!50003 CREATE DEFINER=`root`@`localhost` PROCEDURE `SP_CreateDummyPaymentInfo`(
	_ownerId CHAR(36),
	_maskedCC VARCHAR(40),
	_expirationMonth INT, 
	_expirationYear INT,
	_paymentTokenReferenceId VARCHAR(200),
	_creditCardType VARCHAR(100), 
	_isDefault BIT, 
	_paymentProviderInfoId VARCHAR(200),
	_name VARCHAR(100),
	_address1 VARCHAR(2000),
	_address2 VARCHAR(2000),
	_city VARCHAR(200),
	_stateProvinceCode VARCHAR(100),
	_zipPostalCode VARCHAR(100),
	_countryCode VARCHAR(100),
	_phone VARCHAR(100),
	_status VARCHAR(100),
	_billingFrequency INT, 
	_billingFrequencyType VARCHAR(200),
	_maxCreditAmount DECIMAL(15,6) , 
	IN _vpaCode VARCHAR(100))
BEGIN

	
	DECLARE _addressId CHAR(36);
	DECLARE _vpaId CHAR(36);
	DECLARE _customerHttpAgent VARCHAR(100);
	DECLARE _customerIpAddress VARCHAR(100);
	DECLARE _languageCode VARCHAR(100);
	DECLARE _orderNumber VARCHAR(500);
	DECLARE _userPaymentInfoId CHAR(36);
	DECLARE _currencyCode VARCHAR(100);
	
	
	
	IF ((IFNULL(_paymentProviderInfoId,'') = '') OR (_paymentProviderInfoId ='null') OR (_paymentProviderInfoId =null))
	THEN
	BEGIN   
		SET _paymentProviderInfoId = IFNULL((SELECT id FROM paymentproviderinfo WHERE NAME = 'Invoice' LIMIT 1),'');
	END;
	END IF;
	SET _isDefault = IFNULL(_isDefault,0);
	IF NOT (IFNULL(_ownerId,'') = '')
	THEN
	BEGIN
		SET _addressId = UUID();
		SET _customerHttpAgent = NULL;
		SET _customerIpAddress = NULL;
		SET _languageCode = NULL;
		
		
		SET _userPaymentInfoId = UUID();
		SET _orderNumber = UPPER(UUID());
		SET _orderNumber = SUBSTRING(_orderNumber, 1, LOCATE('-', _orderNumber)-1);
		SELECT (IFNULL((SELECT PropertyValue FROM invoiceproperties WHERE PropertyName = 'defaultcurrencycode'),'USD')) INTO _currencyCode;
		
	
		
		IF NOT EXISTS (SELECT * FROM UserPaymentInfo WHERE ownerid = _ownerId AND IsDefault = 1 AND STATUS = 'Active')
		THEN
		BEGIN
			
			INSERT INTO Address
			   (Id
			   ,NAME
			   ,Address1
			   ,Address2
			   ,City
			   ,StateProvinceCode
			   ,ZipPostalCode
			   ,CountryCode
			   ,CreateTime
			   ,UpdateTime
			   )
		     VALUES
			   (_addressId                  
			   ,_name                       
			   ,_address1                   
			   ,_address2			
			   ,_city			
			   ,_stateProvinceCode   	
			   ,_zipPostalCode		
			   ,_countryCode		
			   ,UTC_TIMESTAMP()			
			   ,UTC_TIMESTAMP()			
			   );
			   
		    
			INSERT INTO UserPaymentInfo
			   (Id
			   ,NAME
			   ,ExpirationMonth
			   ,ExpirationYear
			   ,CreditCardType
			   ,MaskedCreditCardNumber
			   ,PaymentTokenReferenceCode
			   ,AddressId
			   ,OwnerId
			   ,PaymentProviderInfoId
			   ,IsDefault
			   ,CustomerHttpAgent
			   ,CustomerIpAddress
			   ,LanguageCode
			   ,CountryCode
			   ,STATUS
			   ,CreateTime
			   ,UpdateTime
			   )
		     VALUES
			   (_userPaymentInfoId		       
			   ,_name                              
			   ,_expirationMonth
			   ,_expirationYear		       
			   ,_creditCardType                    
			   ,_maskedCC                          
			   ,_paymentTokenReferenceId	       
			   ,_addressId                         
			   ,_ownerId                           
			   ,_paymentProviderInfoId             
			   ,_isDefault                         
			   ,_customerHttpAgent                 
			   ,_customerIpAddress                 
			   ,_languageCode                      
			   ,_countryCode                       
			   ,_status                            
			   ,UTC_TIMESTAMP()		       
			   ,UTC_TIMESTAMP()                    
			   );
			   
			   CALL SP_CreatePaymentOrderDto(_name,_orderNumber,'Recurring','1.00',_currencyCode,_countryCode,NULL,_ownerId,'Success',NULL,NULL,NULL,_userPaymentInfoId,1);		
			   CALL SP_CreateUserBillingInfo ( _ownerId, _billingFrequency, _billingFrequencyType, NULL, _maxCreditAmount);
			   CALL SP_UpdateBillingAddress(_ownerId,_isDefault,_userPaymentInfoId);
			   
			   SELECT _userPaymentInfoId AS userPaymentInfoId, _ownerId AS ownerId;
		END;
		ELSEIF EXISTS (SELECT * FROM UserPaymentInfo WHERE ownerid = _ownerId AND IsDefault = 1 AND STATUS = 'Active')
		THEN
		BEGIN
			
			SELECT (
				SELECT AddressId
				FROM UserPaymentInfo
				WHERE IsDefault = 1 AND STATUS = 'Active'
					AND OwnerID = _ownerId
				)
			INTO _addressId;
			
			
			UPDATE Address SET
				   NAME = CASE WHEN _name = 'NA' THEN NAME ELSE _name END
				   ,Address1 = CASE WHEN _address1 = 'NA' THEN Address1 ELSE _address1 END
				   ,Address2 = CASE WHEN _address2 = 'NA' THEN Address2 ELSE _address2 END
				   ,City =  CASE WHEN _city = 'NA' THEN City ELSE _city END
				   ,StateProvinceCode = CASE WHEN _stateProvinceCode = 'NA' THEN StateProvinceCode ELSE _stateProvinceCode END
				   ,ZipPostalCode = CASE WHEN _zipPostalCode = 'NA' THEN ZipPostalCode ELSE _zipPostalCode END
				   ,CountryCode = CASE WHEN _countryCode = 'NA' THEN CountryCode ELSE _countryCode END
				   ,UpdateTime = UTC_TIMESTAMP()
			WHERE Id = _addressId;
			
		END;
		ELSE
		BEGIN
			SELECT CONCAT('BillingAddress -- ',_paymentTokenReferenceId,'ia assigned to some other account') AS Error;
		END;
		END IF;
		
		
		SELECT (SELECT IFNULL(Id,'') FROM VpaCode WHERE VpaCode = _vpaCode) INTO _vpaId;
		
		IF (IFNULL(_vpaId,'') != '')
		THEN 
		BEGIN
			UPDATE userbillinginfo SET VpaId = _vpaId WHERE OwnerId = _ownerId;
		END;
		END IF;
		
	END;
	ELSE 
	BEGIN
		SELECT CONCAT('OwnerId Not Exists in UserEmail for Email ',_ownerId) AS Error;
	END;
	END IF;
    END */$$
DELIMITER ;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
